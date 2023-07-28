import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SvgTile } from '../models/app.models';
import { DbService } from '../services/db.service';
import { liveQuery } from 'dexie';


@Component({
  selector: 'app-tile-selection-menu',
  templateUrl: './tile-selection-menu.component.html',
  styleUrls: ['./tile-selection-menu.component.scss']
})
export class TileSelectionMenuComponent implements OnInit{
  constructor(private sanitizer: DomSanitizer, private db: DbService) { }

  selectedTileset: string = 'walls_exterior_house_01';
  tilesets: string[] = [];
  tiles: SvgTile[] = [];

  ngOnInit(): void {
    this.getTilesets();
  }

  async getTilesets() {
    const ret =  await this.db.getTilesets();
    ret.forEach((tileset) => {
      this.tilesets.push(tileset.name);
    });
    console.log('AAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    console.log(this.tilesets);
    return ret;
  }

  async getIndividualTiles(sheetName: string) {
    const ret = await this.db.getTiles(sheetName);
    this.tiles = [];
    ret.forEach((tile) => {
      this.tiles.push({
        name: tile.name,
        url: this.sanitizer.bypassSecurityTrustResourceUrl(tile.url),
        x: 0,
        y: 0,
        layer: this.getSelectedLayer(),
      });
    });
  }



  // getTilesets(): string[] {
  //   const tilesets: string[] = [];
  //   for (let i = 0; i < localStorage.length; i++) {
  //     const key = localStorage.key(i);
  //     if (key?.includes('png')) {
  //       const tileset = key.split('_');
  //       tileset.pop();
  //       const tilesetString = tileset.join('_');
  //       if (!tilesets.includes(tilesetString)) {
  //         tilesets.push(tilesetString);
  //       }
  //     }
  //   }
  //   return tilesets;
  // }


  // getIndividualTiles(sheetName: string): SvgTile[] {
  //   const individualTiles: SvgTile[] = [];
  
  //   for (let i = 0; i < 64; i++) { // Replace `numTiles` with the number of tiles you have
  //     const tileName = `${sheetName}_${i}.png`;
  //     const tileUrl = localStorage.getItem(tileName);
  //     if (tileUrl) {
  //       const sanitizedTile = this.sanitizer.bypassSecurityTrustResourceUrl(tileUrl);
  //       individualTiles.push({
  //         name: tileName,
  //         url: sanitizedTile,
  //         x: 0,
  //         y: 0,
  //         layer: 'Walls',
  //       });
  //     }
  //   }
  
  //   return individualTiles;
  // }

  setSelectedTile(tileName: string) {
    console.log(tileName);
    localStorage.setItem('selectedTile', tileName);
  }

  getSelectedTile(): string {
    return localStorage.getItem('selectedTile') || 'walls_exterior_house_01_0.png';
  }

  setSelectedLayer(layer: string) {
    console.log(layer);
    localStorage.setItem('selectedLayer', layer);
  }

  getSelectedLayer(): string {
    return localStorage.getItem('selectedLayer') || 'Walls';
  }

  setSelectedTileset(tileset: string) {
    console.log(tileset);
    localStorage.setItem('selectedTileset', tileset);
    this.selectedTileset = tileset;
    this.getIndividualTiles(tileset);
  }

  getSelectedTileset(): string {
    return localStorage.getItem('selectedTileset') || 'walls_exterior_house_01';
  }
}
