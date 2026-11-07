import { Inject, Injectable, InjectionToken } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { copyLocalBlob, LOCAL_FILE_SNAPSHOT_VERSION } from '../utils/local-file-snapshot';

interface StoredFile {
  name: string;
  blob: Blob;
  type: string;
  lastModified: number;
}

interface StoredResource extends StoredFile {
  path: string;
}

interface StoredWorld {
  id: string;
  world: StoredFile;
  resources: StoredResource[];
  folderName: string;
  warnings: string[];
  omittedResources: number;
  snapshotVersion?: number;
}

export interface WorldedSavedProject {
  worldFile: File;
  files: Map<string, File>;
  folderName: string;
  warnings: string[];
  omittedResources: number;
}

export interface WorldedSnapshotResult {
  worldFile: File;
  files: ReadonlyMap<string, File>;
  omittedResources: number;
}

export const WORLDED_SNAPSHOT_LIMIT = 64 * 1024 * 1024;
export const WORLDED_STORAGE_DATABASE = new InjectionToken<string>('WorldEd storage database', {
  providedIn: 'root',
  factory: () => 'worlded-viewer',
});

async function storedFile(file: File): Promise<StoredFile> {
  return { name: file.name, blob: await copyLocalBlob(file, file.name), type: file.type, lastModified: file.lastModified };
}

function validateStoredFile(record: StoredFile): void {
  if (!record || !(record.blob instanceof Blob) || typeof record.name !== 'string' || !record.name ||
      typeof record.type !== 'string' || !Number.isFinite(record.lastModified)) {
    throw new Error('The saved world contains an invalid file.');
  }
}

function restoredFile(record: StoredFile): File {
  return new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
}

@Injectable({ providedIn: 'root' })
export class WorldedStorageService extends Dexie {
  private worlds!: Table<StoredWorld, string>;
  private writes: Promise<void> = Promise.resolve();

  constructor(@Inject(WORLDED_STORAGE_DATABASE) databaseName: string) {
    super(databaseName);
    this.version(1).stores({ worlds: '&id' });
  }

  lastWorld(): Promise<WorldedSavedProject | undefined> {
    const read = this.writes.then(async () => {
      let stored = await this.worlds.get('last');
      if (!stored) return undefined;
      if (!Array.isArray(stored.resources) || !Array.isArray(stored.warnings) ||
          typeof stored.folderName !== 'string' || !Number.isSafeInteger(stored.omittedResources) ||
          stored.omittedResources < 0 || stored.warnings.some(warning => typeof warning !== 'string')) {
        throw new Error('The saved world is invalid.');
      }
      validateStoredFile(stored.world);
      let size = stored.world.blob.size;
      const paths = new Set<string>();
      for (const resource of stored.resources) {
        if (!resource || typeof resource.path !== 'string' || !resource.path || paths.has(resource.path)) {
          throw new Error('The saved world contains an invalid resource path.');
        }
        validateStoredFile(resource);
        size += resource.blob.size;
        paths.add(resource.path);
      }
      if (size > WORLDED_SNAPSHOT_LIMIT) throw new Error('The saved world exceeds the browser snapshot size limit.');
      if (stored.snapshotVersion === undefined) {
        try {
          const world = { ...stored.world, blob: await copyLocalBlob(stored.world.blob, stored.world.name) };
          const resources: StoredResource[] = [];
          for (const resource of stored.resources) {
            resources.push({ ...resource, blob: await copyLocalBlob(resource.blob, resource.name) });
          }
          stored = { ...stored, world, resources, snapshotVersion: LOCAL_FILE_SNAPSHOT_VERSION };
          await this.worlds.put(stored);
        } catch (error) {
          throw new Error(`Could not upgrade the saved world; select its .pzw and project folder again. ` +
            `${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (stored.snapshotVersion !== LOCAL_FILE_SNAPSHOT_VERSION) {
        throw new Error('The saved world uses an unsupported snapshot format.');
      }
      const files = new Map<string, File>();
      for (const resource of stored.resources) files.set(resource.path, restoredFile(resource));
      return {
        worldFile: restoredFile(stored.world), files, folderName: stored.folderName,
        warnings: stored.warnings, omittedResources: stored.omittedResources,
      };
    });
    this.writes = read.then(() => undefined, () => undefined);
    return read;
  }

  rememberWorld(project: WorldedSavedProject): Promise<WorldedSnapshotResult> {
    if (project.worldFile.size > WORLDED_SNAPSHOT_LIMIT) {
      return Promise.reject(new Error('The world file exceeds the browser snapshot size limit.'));
    }
    let size = project.worldFile.size;
    let omittedResources = 0;
    const selected: { path: string; file: File }[] = [];
    for (const [path, file] of project.files) {
      if (file.size > WORLDED_SNAPSHOT_LIMIT - size) {
        omittedResources++;
      } else {
        size += file.size;
        selected.push({ path, file });
      }
    }
    const { worldFile, folderName } = project;
    const warnings = [...project.warnings];
    const write = this.writes.then(async () => {
      const world = await storedFile(worldFile);
      const resources: StoredResource[] = [];
      for (const entry of selected) resources.push({ path: entry.path, ...await storedFile(entry.file) });
      await this.worlds.put({
        id: 'last', world, resources, folderName, warnings, omittedResources,
        snapshotVersion: LOCAL_FILE_SNAPSHOT_VERSION,
      });
      return {
        worldFile: restoredFile(world),
        files: new Map(resources.map(resource => [resource.path, restoredFile(resource)])),
        omittedResources,
      };
    });
    this.writes = write.then(() => undefined, () => undefined);
    return write;
  }
}
