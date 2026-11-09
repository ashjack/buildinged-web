import { Inject, Injectable, InjectionToken } from '@angular/core';
import Dexie, { Table } from 'dexie';
import type { ProjectWorldDocument, ProjectWorldFile } from './project-world.service';

export const PROJECT_WORLD_CACHE_DATABASE = new InjectionToken<string>('Project world cache database', {
  providedIn: 'root', factory: () => 'project-world-cache',
});
interface CachedWorld { scope: string; projectId: string; document: ProjectWorldDocument; }
interface CachedBlob { scope: string; projectId: string; hash: string; blob: Blob; }
interface CachedAlias { scope: string; projectId: string; id: string; hash: string; }
export interface CachedWorldFile { hash: string; blob: Blob; }

export async function worldFileHash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class ProjectWorldCacheService extends Dexie {
  private snapshots!: Table<CachedWorld, [string, string]>;
  private blobs!: Table<CachedBlob, [string, string, string]>;
  private aliases!: Table<CachedAlias, [string, string, string]>;

  constructor(@Inject(PROJECT_WORLD_CACHE_DATABASE) database: string) {
    super(database);
    this.version(1).stores({ snapshots: '[scope+projectId]',
      blobs: '[scope+projectId+hash], [scope+projectId]',
      aliases: '[scope+projectId+id], [scope+projectId]' });
  }
  async world(scope: string, projectId: string): Promise<ProjectWorldDocument | undefined> {
    return (await this.snapshots.get([scope, projectId]))?.document;
  }
  async rememberWorld(scope: string, document: ProjectWorldDocument): Promise<void> {
    await this.transaction('rw', this.snapshots, async () => {
      const current = await this.world(scope, document.projectId);
      if (!current || current.revision <= document.revision) {
        await this.snapshots.put({ scope, projectId: document.projectId, document });
      }
    });
  }
  async hash(scope: string, projectId: string, id: string): Promise<string | undefined> {
    return (await this.aliases.get([scope, projectId, id]))?.hash;
  }
  async alias(scope: string, projectId: string, id: string, hash: string): Promise<void> {
    await this.aliases.put({ scope, projectId, id, hash });
  }
  async file(scope: string, projectId: string, entry: ProjectWorldFile): Promise<CachedWorldFile | undefined> {
    const hash = entry.sha256 ?? await this.hash(scope, projectId, entry.id);
    if (!hash) return undefined;
    const record = await this.blobs.get([scope, projectId, hash]);
    if (!record || !(record.blob instanceof Blob) || record.blob.size !== entry.size) return undefined;
    await this.aliases.put({ scope, projectId, id: entry.id, hash });
    return { hash, blob: record.blob };
  }
  async rememberFile(scope: string, projectId: string, entry: ProjectWorldFile, file: CachedWorldFile): Promise<void> {
    await this.transaction('rw', this.blobs, this.aliases, async () => {
      if (!await this.blobs.get([scope, projectId, file.hash])) {
        await this.blobs.put({ scope, projectId, hash: file.hash, blob: file.blob });
      }
      await this.aliases.put({ scope, projectId, id: entry.id, hash: file.hash });
    });
  }
  async prune(scope: string, world: ProjectWorldDocument): Promise<void> {
    await this.transaction('rw', this.snapshots, this.blobs, this.aliases, async () => {
      if ((await this.world(scope, world.projectId))?.revision !== world.revision) return;
      const ids = new Set(world.files.map(file => file.id));
      const aliases = this.aliases.where('[scope+projectId]').equals([scope, world.projectId]);
      await aliases.filter(alias => !ids.has(alias.id)).delete();
      const hashes = new Set((await this.aliases.where('[scope+projectId]')
        .equals([scope, world.projectId]).toArray()).map(alias => alias.hash));
      await this.blobs.where('[scope+projectId]').equals([scope, world.projectId])
        .filter(blob => !hashes.has(blob.hash)).delete();
    });
  }
}
