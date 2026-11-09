import { Injectable } from '@angular/core';
import { ProjectApiService, ProjectRequestError } from './project-api.service';
import { AuthService } from './auth.service';
import { CachedWorldFile, ProjectWorldCacheService, worldFileHash } from './project-world-cache.service';
import { WorldedSavedProject } from './worlded-storage.service';
import { readWorldedWorld } from '../utils/worlded-world';

export const WORLD_ADMIN_UID = 'gK0MQfxb5XVs8SGlF1GVKUYXQdK2';
export interface ProjectWorldFile { id: string; path: string; size: number; sha256?: string; }
export interface ProjectWorld {
  projectId: string;
  name: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  files: ProjectWorldFile[];
}
export interface ProjectWorldDocument extends ProjectWorld { xml: string; }

@Injectable({ providedIn: 'root' })
export class ProjectWorldService {
  cacheWarning = '';
  private cacheEnabled = true;
  private legacyApis = new Set<string>();
  private pending = new Map<string, Promise<CachedWorldFile>>();
  private memory?: { scope: string; projectId: string; files: Map<string, File> };

  constructor(private api: ProjectApiService, private auth: AuthService, private cache: ProjectWorldCacheService) { }
  private scope(): string {
    if (!this.auth.user) throw new Error('Sign in to synchronize project worlds.');
    return JSON.stringify([this.auth.apiBaseUrl, this.auth.user.uid]);
  }
  private checkScope(scope: string): void {
    if (scope !== this.scope()) throw new Error('Your account changed. Reopen the project world.');
  }
  private async cached<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.cacheEnabled) return fallback;
    try { return await operation(); }
    catch {
      this.cacheEnabled = false;
      this.cacheWarning = 'The browser could not save the world cache. Free browser storage to keep files between visits.';
      return fallback;
    }
  }
  async world(projectId: string): Promise<ProjectWorldDocument | null> {
    const scope = this.scope();
    const saved = await this.cached(() => this.cache.world(scope, projectId), undefined);
    if (saved && !this.legacyApis.has(this.auth.apiBaseUrl)) {
      try {
        const status = await this.api.request<{ revision: number } | null>('GET', `/projects/${encodeURIComponent(projectId)}/world-status`);
        this.checkScope(scope);
        if (!status) return null;
        if (status.revision === saved.revision) return saved;
      } catch (error) {
        if (!(error instanceof ProjectRequestError) || error.status !== 404) throw error;
        this.legacyApis.add(this.auth.apiBaseUrl);
      }
    }
    const world = await this.api.request<ProjectWorldDocument | null>('GET', `/projects/${encodeURIComponent(projectId)}/world`);
    this.checkScope(scope);
    if (world) {
      readWorldedWorld(world.xml);
      await this.cached(() => this.cache.rememberWorld(scope, world), undefined);
    }
    return world;
  }
  private resource(scope: string, projectId: string, entry: ProjectWorldFile): Promise<CachedWorldFile> {
    const key = JSON.stringify([scope, projectId, entry.sha256 ?? entry.id]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      this.checkScope(scope);
      const saved = await this.cached(() => this.cache.file(scope, projectId, entry), undefined);
      if (saved) return saved;
      const response = await this.api.request<{ data: string }>('GET', `/world-files/${encodeURIComponent(entry.id)}`);
      this.checkScope(scope);
      const binary = atob(response.data);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (bytes.length !== entry.size) throw new Error(`Incomplete world resource: ${entry.path}`);
      const hash = await worldFileHash(bytes.buffer);
      if (entry.sha256 && hash !== entry.sha256) throw new Error(`World resource checksum failed: ${entry.path}`);
      const file = { hash, blob: new Blob([bytes]) };
      await this.cached(() => this.cache.rememberFile(scope, projectId, entry, file), undefined);
      return file;
    })();
    this.pending.set(key, request);
    const forget = () => { if (this.pending.get(key) === request) this.pending.delete(key); };
    request.then(forget, forget);
    return request;
  }
  async file(world: ProjectWorld, entry: ProjectWorldFile): Promise<File> {
    if (!world.files.some(file => file.id === entry.id && file.path === entry.path)) {
      throw new Error('This file is not part of the uploaded world.');
    }
    const scope = this.scope();
    const name = entry.path.split('/').pop()!;
    const key = JSON.stringify([entry.sha256 ?? entry.id, name]);
    const retained = this.memory?.scope === scope && this.memory.projectId === world.projectId
      ? this.memory.files.get(key) : undefined;
    if (retained) return retained;
    const saved = await this.resource(scope, world.projectId, entry);
    this.checkScope(scope);
    return new File([saved.blob], name);
  }
  async resources(world: ProjectWorld, progress: (text: string) => void): Promise<Map<string, File>> {
    const scope = this.scope();
    const previous = this.memory?.scope === scope && this.memory.projectId === world.projectId ? this.memory.files : new Map<string, File>();
    const retained = new Map<string, File>();
    const files = new Map<string, File>();
    let next = 0;
    let failed = false;
    const worker = async () => {
      while (!failed && next < world.files.length) {
        const entry = world.files[next++];
        this.checkScope(scope);
        const name = entry.path.split('/').pop()!;
        const key = JSON.stringify([entry.sha256 ?? entry.id, name]);
        let file = previous.get(key);
        if (!file || file.size !== entry.size) {
          const saved = await this.resource(scope, world.projectId, entry);
          this.checkScope(scope);
          const hashKey = JSON.stringify([saved.hash, name]);
          file = previous.get(hashKey) ?? new File([saved.blob], name);
          retained.set(hashKey, file);
        }
        retained.set(key, file);
        if (entry.sha256) await this.cached(() => this.cache.alias(scope, world.projectId, entry.id, entry.sha256!), undefined);
        files.set(entry.path, file);
        progress(`Preparing project files: ${files.size} / ${world.files.length} (reusing downloaded files)`);
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(3, world.files.length) }, () => worker())); }
    catch (error) { failed = true; throw error; }
    this.checkScope(scope);
    this.memory = { scope, projectId: world.projectId, files: retained };
    if ('xml' in world) await this.cached(() => this.cache.prune(scope, world as ProjectWorldDocument), undefined);
    return files;
  }
  async upload(projectId: string, project: WorldedSavedProject, revision: number,
    progress: (text: string) => void): Promise<ProjectWorld> {
    if (project.omittedResources) throw new Error('Select the complete project folder before uploading.');
    if (project.worldFile.size > 8 * 1024 * 1024) throw new Error('The PZW file exceeds 8 MiB.');
    const xml = await project.worldFile.text();
    readWorldedWorld(xml);
    let total = 0;
    if (project.files.size > 4096) throw new Error('Choose a world with at most 4096 resource files.');
    for (const [path, file] of project.files) {
      if (file.size > 16 * 1024 * 1024) throw new Error(`${path} exceeds the 16 MiB resource limit.`);
      total += file.size;
    }
    if (total > 512 * 1024 * 1024) throw new Error('World resources exceed 512 MiB.');
    const scope = this.scope();
    const current = await this.world(projectId);
    if ((current?.revision ?? 0) !== revision) throw new Error('The cloud world changed. Load the latest world before replacing it.');
    const byPath = new Map(current?.files.map(file => [file.path, file]));
    const fileIds: string[] = [];
    const prepared = new Map<string, File>();
    for (const [path, file] of project.files) {
      this.checkScope(scope);
      progress(`Synchronizing project files: ${fileIds.length + 1} / ${project.files.size}`);
      const buffer = await file.arrayBuffer();
      const hash = await worldFileHash(buffer);
      const name = path.split('/').pop()!;
      const snapshot = new File([buffer], name, { type: file.type });
      prepared.set(JSON.stringify([hash, name]), snapshot);
      const prior = byPath.get(path);
      const priorHash = prior?.sha256 ?? (prior && await this.cached(() => this.cache.hash(scope, projectId, prior.id), undefined));
      if (prior && prior.size === file.size && priorHash === hash) {
        fileIds.push(prior.id);
        prepared.set(JSON.stringify([prior.id, name]), snapshot);
        await this.cached(() => this.cache.rememberFile(scope, projectId, prior, { hash, blob: snapshot }), undefined);
        continue;
      }
      const bytes = new Uint8Array(buffer);
      const pieces: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
      }
      const data = btoa(pieces.join(''));
      const result = await this.api.request<{ id: string }>('POST', `/projects/${encodeURIComponent(projectId)}/world-files`, { path, data, sha256: hash });
      fileIds.push(result.id);
      prepared.set(JSON.stringify([result.id, name]), snapshot);
      await this.cached(() => this.cache.rememberFile(scope, projectId, { id: result.id, path, size: file.size }, { hash, blob: snapshot }), undefined);
    }
    progress('Publishing the project world…');
    const result = await this.api.request<ProjectWorld>('POST', `/projects/${encodeURIComponent(projectId)}/world`, {
      name: project.worldFile.name, xml, fileIds, revision,
    });
    this.checkScope(scope);
    this.memory = { scope, projectId, files: prepared };
    await this.cached(() => this.cache.rememberWorld(scope, { ...result, xml }), undefined);
    return result;
  }
  async save(projectId: string, xml: string, revision: number): Promise<ProjectWorld> {
    readWorldedWorld(xml);
    const scope = this.scope();
    const result = await this.api.request<ProjectWorld>('PUT', `/projects/${encodeURIComponent(projectId)}/world`, { xml, revision });
    this.checkScope(scope);
    await this.cached(() => this.cache.rememberWorld(scope, { ...result, xml }), undefined);
    return result;
  }
}
