import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SvgTile } from '../models/app.models';
import { DbService } from '../services/db.service';
import { liveQuery } from 'dexie';


@Component({
  selector: 'app-furniture-selection-menu',
  templateUrl: './furniture-selection-menu.component.html',
  styleUrls: ['./furniture-selection-menu.component.scss']
})
export class FurnitureSelectionMenuComponent implements OnInit{
  constructor(private sanitizer: DomSanitizer, private db: DbService) { }

  selectedTileset: string = 'walls_exterior_house_01';
  tilesets: string[] = [];
  tiles: SvgTile[] = [];

  layers: string[] = [
    'RoofTop',
    'Roof2',
    'Roof',
    'WallOverlay4',
    'WallOverlay3',
    'WallFurniture4',
    'WallFurniture3',
    'Curtains2',
    'Furniture4',
    'Furniture3',
    'Furniture2',
    'Furniture',
    'Curtains',
    'Windows',
    'Doors',
    'Frames',
    'WallFurniture2',
    'WallFurniture',
    'WallGrime2',
    'WallGrime',
    'WallOverlay2',
    'WallOverlay',
    'RoofCap2',
    'RoofCap',
    'WallTrim2',
    'Walls2',
    'WallTrim',
    'Walls',
    'Vegetation',
    'FloorFurniture',
    'FloorGrime2',
    'FloorGrime',
    'FloorOverlay', 
    'Floor', 
  ];

  ngOnInit(): void {
    this.getTilesets();
  }

  async getTilesets() {
    const ret =  await this.db.getTilesets();
    ret.forEach((tileset) => {
      this.tilesets.push(tileset.name);
    });
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
        level: this.getSelectedLevel(),
      });
    });
  }

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

  setSelectedLevel(level: number) {
    console.log(level);
    localStorage.setItem('selectedLevel', level.toString());
  }

  getSelectedLevel(): number {
    return parseInt(localStorage.getItem('selectedLevel') || '0');
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
