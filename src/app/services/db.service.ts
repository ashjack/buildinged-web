// db.ts
import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { Subject } from 'rxjs';
import { SheetAtlas } from '../utils/sheet-atlas';

/** A single tile, cut from its sheet on demand. `url` is an object URL owned by the tile cache. */
export interface PngTile {
  name: string;
  url: string;
  tileset: string;
}

export interface Tileset {
  name: string;
  packName: string;
  columns: number;
  rows: number;
  /** Where the sheet came from (zip entry path or sheet URL). */
  url?: string;
}

/** Whole tilesheet PNG, kept apart from `tilesets` so listing sheets never loads image data. */
export interface SheetImage {
  name: string;
  blob: Blob;
}

export interface Tilepack {
  name: string;
  enabled: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class DbService extends Dexie {
  tilesets!: Table<Tileset, string>;
  sheetImages!: Table<SheetImage, string>;
  tilepacks!: Table<Tilepack, boolean>;

  /** Emits sheet names whose stored image was added, replaced or removed. */
  readonly sheetsChanged = new Subject<string[]>();
  private readonly atlas = new SheetAtlas({
    getSheetInfo: name => this.tilesets.get(name),
    getSheetBlob: async name => (await this.sheetImages.get(name))?.blob,
  });

  constructor() {
    super('tilesets');
    this.version(4).stores({
      pngTiles: '&name, url, tileset',
      tilesets: '&name, url, packName',
      tilepacks: '&name, enabled',
    });
    // Tiles used to be stored one data URL per row; sheets are now stored whole. Old caches are dropped and re-downloaded.
    this.version(5).stores({
      pngTiles: null,
      tilesets: '&name, packName',
      sheetImages: '&name',
      tilepacks: '&name, enabled',
    }).upgrade(tx => tx.table('tilesets').clear());
    // Dexie closes for good when the database is deleted (e.g. from DevTools). Reopen so tiles can be re-downloaded without a reload.
    this.on('versionchange', (event: IDBVersionChangeEvent) => {
      if (!event.newVersion) {
        this.close();
        this.open().catch(error => console.error('Could not reopen the tile database:', error));
      }
    });
    this.sheetsChanged.subscribe(sheets => this.atlas.invalidate(sheets));

    this.open(); // <---- Missing in OP
  }

  //Tilepacks
  async addTilepack(name: string, enabled: boolean) {
    const tilepack = await this.tilepacks.where({
      name: name
    }).toArray();

    if(tilepack.length > 0) {
      return;
    }

    await this.tilepacks.add({
      name,
      enabled
    });
  }

  async getTilepack(name: string) {
    return await this.tilepacks
    .where({
      name: name
    })
      .toArray();
  }

  async getTilepacks() {
    return await this.tilepacks.toArray();
  }

  async hasTilepack(name: string) {
    const tilepack = await this.tilepacks.where({
      name: name
    })
    .toArray();

    return tilepack.length > 0;
  }

  //Tilesets
  /** Stores whole sheets (metadata and image) in one transaction. */
  async putSheets(sheets: { tileset: Tileset; blob: Blob }[]) {
    if (!sheets.length) return;
    await this.transaction('rw', this.tilesets, this.sheetImages, async () => {
      await this.sheetImages.bulkPut(sheets.map(sheet => ({ name: sheet.tileset.name, blob: sheet.blob })));
      await this.tilesets.bulkPut(sheets.map(sheet => sheet.tileset));
    });
    this.sheetsChanged.next(sheets.map(sheet => sheet.tileset.name));
  }

  async getTileset(name: string) {
    return await this.tilesets
    .where({
      name: name
    })
      .toArray();
  }

  async getTilesets() {
    return await this.tilesets.toArray();
  }

  async hasTileset(name: string) {
    return (await this.tilesets.where('name').equals(name).count()) > 0;
  }

  /** Names from the list that are already stored. */
  async existingTilesets(names: string[]): Promise<Set<string>> {
    const keys = await this.tilesets.where('name').anyOf(names).primaryKeys();
    return new Set(keys as string[]);
  }

  async hasPackTilesets(packName: string) {
    return (await this.tilesets.where('packName').equals(packName).count()) > 0;
  }

  //Tiles
  /** Whether a tile exists, without loading any image data. */
  hasTile(name: string): Promise<boolean> {
    return this.atlas.hasTile(name);
  }

  /** The tile as a bitmap for canvas drawing. */
  getTileBitmap(name: string): Promise<ImageBitmap | null> {
    return this.atlas.getTileBitmap(name);
  }

  async getTile(name: string): Promise<PngTile | null> {
    const url = await this.atlas.getTileUrl(name);
    return url ? { name, url, tileset: name.replace(/_\d+(\.png)?$/i, '') } : null;
  }

  async getTiles(tilesetName: string): Promise<PngTile[]> {
    const names = await this.atlas.getTileNames(tilesetName);
    const tiles = await Promise.all(names.map(async name => ({ name, url: await this.atlas.getTileUrl(name), tileset: tilesetName })));
    return tiles.filter((tile): tile is PngTile => !!tile.url);
  }

  async clearTiles(tilepackName: string) {
  try {
    const tilesetNames = await this.tilesets.where('packName').equals(tilepackName).primaryKeys() as string[];
    await this.transaction('rw', this.tilesets, this.sheetImages, async () => {
      await this.sheetImages.bulkDelete(tilesetNames);
      await this.tilesets.bulkDelete(tilesetNames);
    });
    this.sheetsChanged.next(tilesetNames);
  } catch (error) {
    console.error('Error clearing tiles:', error);
    throw error; // Propagate the error
  }
}


}

//export const db = new AppDB();
