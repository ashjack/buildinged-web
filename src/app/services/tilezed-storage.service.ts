import { Inject, Injectable, InjectionToken } from '@angular/core';
import Dexie, { Table } from 'dexie';

interface StoredTilezedMap {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  lastModified: number;
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
  private mapWrites: Promise<void> = Promise.resolve();

  constructor(@Inject(TILEZED_STORAGE_DATABASE) databaseName: string) {
    super(databaseName);
    this.version(1).stores({ maps: '&id', sheets: '&name, packName' });
  }

  async lastMap(): Promise<File | undefined> {
    await this.mapWrites;
    const stored = await this.maps.get('last');
    if (!stored) return undefined;
    if (!(stored.blob instanceof Blob) || !stored.name) throw new Error('The saved map is invalid.');
    return new File([stored.blob], stored.name, { type: stored.type, lastModified: stored.lastModified });
  }

  rememberMap(file: File): Promise<void> {
    const write = this.mapWrites.then(async () => {
      await this.maps.put({ id: 'last', name: file.name, blob: file, type: file.type, lastModified: file.lastModified });
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
