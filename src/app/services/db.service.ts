// db.ts
import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface PngTile {
  name: string;
  url: string;
  tileset: string;
}

export interface Tileset {
  name: string;
  url: string;
}

@Injectable({
  providedIn: 'root',
})
export class DbService extends Dexie {
  pngTiles!: Table<PngTile, number>;
  tilesets!: Table<Tileset, number>;

  constructor() {
    super('tilesets');
    this.version(4).stores({

      pngTiles: '&name, url, tileset',
      tilesets: '&name, url',
    });
    //this.open(); // <---- Missing in OP
  }

  //Tilesets
  async addTileset(name: string, url: string) {    
    const tileset = await this.tilesets.where({
      name: name
    })
    .toArray();

    if (tileset.length > 0) {
      return;
    }

    await this.tilesets.add({
      name,
      url
    });
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
    const tileset = await this.tilesets.where({
      name: name
    })
    .toArray();

    return tileset.length > 0;
  }

  //Tiles
  async addTile(name: string, url: string, tileset: string) {

    const tile = await this.pngTiles.where({
      name: name
    }).toArray();

    if (tile.length > 0) {
      return;
    }

    await this.pngTiles.add({
      name,
      url,
      tileset
    });
  }

  async getTile(name: string) {
    const tile =  await this.pngTiles
    .where({
      name: name
    })
      .toArray();

      if(tile.length === 0) {
        return null;
      }
    return tile[0];
  }

  async getTiles(tilesetName: string) {
    return await this.pngTiles
    .where({
      tileset: tilesetName
    })
      .toArray();
  }

}

//export const db = new AppDB();