import { Inject, Injectable, InjectionToken } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { copyLocalBlob, LOCAL_FILE_SNAPSHOT_VERSION } from '../utils/local-file-snapshot';
import { TilezedBuildingContext } from './tilezed-handoff.service';
import { worldedFileFor, worldedReferenceKey } from '../utils/worlded-files';
import { BuildingPreview } from '../utils/building-preview';

interface StoredBuildingPreview extends BuildingPreview { key: string; lastUsed: number; }

interface StoredTilezedMap {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  lastModified: number;
  snapshotVersion?: number;
  buildings?: { lots: TilezedBuildingContext['lots']; files: { path: string; name: string; blob: Blob; type: string; lastModified: number }[] };
}

export interface StoredTilezedSheet {
  name: string;
  blob: Blob;
  packName: string;
  version: string;
}

interface CachedTilezedSheet extends StoredTilezedSheet {
  installedVersion: string | null;
}

export const TILEZED_STORAGE_DATABASE = new InjectionToken<string>('TileZed storage database', {
  providedIn: 'root',
  factory: () => 'tilezed-viewer',
});

@Injectable({ providedIn: 'root' })
export class TilezedStorageService extends Dexie {
  private maps!: Table<StoredTilezedMap, string>;
  private sheets!: Table<CachedTilezedSheet, string>;
  private buildingPreviews!: Table<StoredBuildingPreview, string>;
  private mapWrites: Promise<void> = Promise.resolve();

  constructor(@Inject(TILEZED_STORAGE_DATABASE) databaseName: string) {
    super(databaseName);
    this.version(1).stores({ maps: '&id', sheets: '&name, packName' });
    this.version(2).stores({ buildingPreviews: '&key, lastUsed' });
  }

  async buildingPreview(key: string): Promise<BuildingPreview | undefined> {
    const preview = await this.buildingPreviews.get(key);
    if (preview) {
      if (!(preview.blob instanceof Blob) || !Number.isSafeInteger(preview.width) ||
          !Number.isSafeInteger(preview.height) || preview.width < 1 || preview.height < 1 ||
          preview.width > 2048 || preview.height > 2048 || !preview.squares ||
          ![preview.squares.minX, preview.squares.minY, preview.squares.maxX, preview.squares.maxY]
            .every(Number.isSafeInteger)) throw new Error('The cached building preview is invalid.');
      await this.buildingPreviews.update(key, { lastUsed: Date.now() });
    }
    return preview;
  }

  async rememberBuildingPreview(key: string, preview: BuildingPreview): Promise<void> {
    await this.transaction('rw', this.buildingPreviews, async () => {
      await this.buildingPreviews.put({ ...preview, key, lastUsed: Date.now() });
      const records = await this.buildingPreviews.orderBy('lastUsed').toArray();
      let bytes = records.reduce((sum, record) => sum + record.blob.size, 0);
      const expired: string[] = [];
      for (const record of records) {
        // Large enough for a whole world's thumbnails, so sequential loads don't evict every entry.
        if (bytes <= 256 * 1024 * 1024) break;
        bytes -= record.blob.size;
        expired.push(record.key);
      }
      await this.buildingPreviews.bulkDelete(expired);
    });
  }

  lastMap(): Promise<File | undefined> {
    const read = this.mapWrites.then(async () => {
      let stored = await this.maps.get('last');
      if (!stored) return undefined;
      if (!(stored.blob instanceof Blob) || typeof stored.name !== 'string' || !stored.name ||
          typeof stored.type !== 'string' || !Number.isFinite(stored.lastModified)) {
        throw new Error('The saved map is invalid.');
      }
      if (stored.snapshotVersion === undefined) {
        try {
          stored = { ...stored, blob: await copyLocalBlob(stored.blob, stored.name),
            snapshotVersion: LOCAL_FILE_SNAPSHOT_VERSION };
          await this.maps.put(stored);
        } catch (error) {
          throw new Error(`Could not upgrade the saved map; select the original .tmx again. ` +
            `${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (stored.snapshotVersion !== LOCAL_FILE_SNAPSHOT_VERSION) {
        throw new Error('The saved map uses an unsupported snapshot format.');
      }
      return new File([stored.blob], stored.name, { type: stored.type, lastModified: stored.lastModified });
    });
    this.mapWrites = read.then(() => undefined, () => undefined);
    return read;
  }

  async lastBuildings(file: File): Promise<TilezedBuildingContext | undefined> {
    await this.mapWrites;
    const stored = await this.maps.get('last');
    if (!stored?.buildings || stored.name !== file.name || stored.blob.size !== file.size ||
        stored.lastModified !== file.lastModified) return undefined;
    if (!Array.isArray(stored.buildings.lots) || !Array.isArray(stored.buildings.files)) {
      throw new Error('The saved building references are invalid.');
    }
    const files = new Map<string, File>();
    for (const resource of stored.buildings.files) {
      if (!resource || typeof resource.path !== 'string' || !(resource.blob instanceof Blob) ||
          typeof resource.name !== 'string' || !resource.name || typeof resource.type !== 'string' ||
          !Number.isFinite(resource.lastModified)) throw new Error('A saved building file is invalid.');
      files.set(resource.path, new File([resource.blob], resource.name,
        { type: resource.type, lastModified: resource.lastModified }));
    }
    for (const lot of stored.buildings.lots) {
      if (!lot || typeof lot.map !== 'string' || [lot.x, lot.y, lot.width, lot.height, lot.level]
        .some(value => !Number.isFinite(value))) throw new Error('A saved building placement is invalid.');
    }
    return { lots: stored.buildings.lots, files };
  }

  rememberMap(file: File, buildings?: TilezedBuildingContext): Promise<void> {
    const lots = buildings?.lots.map(lot => ({ ...lot }));
    const write = this.mapWrites.then(async () => {
      const blob = await copyLocalBlob(file, file.name);
      const files: NonNullable<StoredTilezedMap['buildings']>['files'] = [];
      if (buildings && lots) {
        let bytes = file.size;
        const paths = new Set<string>();
        for (const lot of lots) {
          const path = worldedReferenceKey(lot.map);
          const source = worldedFileFor(buildings.files, lot.map);
          if (!path || !source || paths.has(path)) continue;
          bytes += source.size;
          if (bytes > 64 * 1024 * 1024) throw new Error('Cell map and buildings exceed the 64 MiB snapshot limit.');
          paths.add(path);
          files.push({ path, name: source.name, blob: await copyLocalBlob(source, source.name),
            type: source.type, lastModified: source.lastModified });
        }
      }
      await this.maps.put({ id: 'last', name: file.name, blob, type: file.type,
        lastModified: file.lastModified, snapshotVersion: LOCAL_FILE_SNAPSHOT_VERSION,
        ...(lots ? { buildings: { lots, files } } : {}) });
    });
    // Keep later writes ordered while returning each failure to its caller.
    this.mapWrites = write.catch(() => undefined);
    return write;
  }

  async sheet(name: string): Promise<Blob | undefined> {
    const stored = await this.sheets.get(name);
    if (!stored) return undefined;
    if (!(stored.blob instanceof Blob)) throw new Error(`The cached sheet ${name} is invalid.`);
    const installedVersion = localStorage.getItem(`tilepack-version:${stored.packName}`);
    return installedVersion === stored.installedVersion ? stored.blob : undefined;
  }

  async rememberSheet(sheet: StoredTilezedSheet): Promise<void> {
    const installedVersion = localStorage.getItem(`tilepack-version:${sheet.packName}`);
    await this.sheets.put({ ...sheet, installedVersion });
  }
}
