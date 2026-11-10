import { Inject, Injectable, InjectionToken } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { copyLocalBlob, LOCAL_FILE_SNAPSHOT_VERSION } from '../utils/local-file-snapshot';
import { TilezedBuildingContext } from './tilezed-handoff.service';
import { worldedFileFor, worldedReferenceKey } from '../utils/worlded-files';
import { BuildingPreview, buildingPreviewBytes } from '../utils/building-preview';
import { WorldedZone } from '../utils/worlded-world';

interface StoredBuildingPreview extends BuildingPreview { key: string; lastUsed: number; }

const MAX_BUILDING_PREVIEW_BYTES = 256 * 1024 * 1024;

interface StoredTilezedMap {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  lastModified: number;
  snapshotVersion?: number;
  buildings?: {
    lots: TilezedBuildingContext['lots'];
    files: { path: string; name: string; blob: Blob; type: string; lastModified: number }[];
    zones?: WorldedZone[];
  };
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
  private sheetVersions!: Table<{ key: string; name: string; sha256: string; blob: Blob }, string>;
  private buildingPreviews!: Table<StoredBuildingPreview, string>;
  private mapWrites: Promise<void> = Promise.resolve();
  private buildingPreviewBytes?: number;

  constructor(@Inject(TILEZED_STORAGE_DATABASE) databaseName: string) {
    super(databaseName);
    this.version(1).stores({ maps: '&id', sheets: '&name, packName' });
    this.version(2).stores({ buildingPreviews: '&key, lastUsed' });
    this.version(3).stores({ sheetVersions: '&key, name' });
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
    try {
      await this.transaction('rw', this.buildingPreviews, async () => {
        if (this.buildingPreviewBytes === undefined) {
          let total = 0;
          await this.buildingPreviews.each(record => { total += buildingPreviewBytes(record); });
          this.buildingPreviewBytes = total;
        }
        const previous = await this.buildingPreviews.get(key);
        await this.buildingPreviews.put({ ...preview, key, lastUsed: Date.now() });
        this.buildingPreviewBytes += buildingPreviewBytes(preview) - (previous ? buildingPreviewBytes(previous) : 0);
        // Large enough for a whole world's thumbnails, so sequential loads don't evict every entry.
        if (this.buildingPreviewBytes <= MAX_BUILDING_PREVIEW_BYTES) return;
        const records = await this.buildingPreviews.orderBy('lastUsed').toArray();
        let bytes = records.reduce((sum, record) => sum + buildingPreviewBytes(record), 0);
        const expired: string[] = [];
        for (const record of records) {
          if (bytes <= MAX_BUILDING_PREVIEW_BYTES) break;
          bytes -= buildingPreviewBytes(record);
          expired.push(record.key);
        }
        await this.buildingPreviews.bulkDelete(expired);
        this.buildingPreviewBytes = bytes;
      });
    } catch (error) {
      this.buildingPreviewBytes = undefined;
      throw error;
    }
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
    const zones = stored.buildings.zones;
    if (zones !== undefined && (!Array.isArray(zones) || zones.some(zone => !zone ||
        typeof zone.color !== 'string' || typeof zone.geometry !== 'string' || !Array.isArray(zone.points) ||
        [zone.x, zone.y, zone.width, zone.height, zone.level].some(value => !Number.isFinite(value)) ||
        zone.points.some(point => !Array.isArray(point) || !point.every(Number.isFinite))))) {
      throw new Error('The saved zones are invalid.');
    }
    return { lots: stored.buildings.lots, files, ...(zones ? { zones } : {}) };
  }

  rememberMap(file: File, buildings?: TilezedBuildingContext): Promise<void> {
    const lots = buildings?.lots.map(lot => ({ ...lot }));
    const zones = buildings?.zones?.map(zone => ({ ...zone, points: zone.points.map(([x, y]) => [x, y] as [number, number]) }));
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
        ...(lots ? { buildings: { lots, files, ...(zones?.length ? { zones } : {}) } } : {}) });
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

  async versionedSheet(name: string, sha256: string): Promise<Blob | undefined> {
    const entry = await this.sheetVersions.get(`${name}:${sha256}`);
    return entry?.blob instanceof Blob ? entry.blob : undefined;
  }
  async rememberVersionedSheet(name: string, sha256: string, blob: Blob): Promise<void> {
    await this.transaction('rw', this.sheetVersions, async () => {
      await this.sheetVersions.where('name').equals(name).delete();
      await this.sheetVersions.put({ key: `${name}:${sha256}`, name, sha256, blob });
    });
  }

  async rememberSheet(sheet: StoredTilezedSheet): Promise<void> {
    const installedVersion = localStorage.getItem(`tilepack-version:${sheet.packName}`);
    await this.sheets.put({ ...sheet, installedVersion });
  }
}
