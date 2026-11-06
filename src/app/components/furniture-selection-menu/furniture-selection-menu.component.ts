import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SvgTile } from '../../models/app.models';
import { DbService } from '../../services/db.service';
import { liveQuery } from 'dexie';
import * as fromRoot from '../../app.reducers';
import { Store } from "@ngrx/store";
import { Subscription } from 'rxjs';
import { BEntry, BEntryItem, BFurniture, BFurnitureGroup, VisualFurniture, VisualFurnitureEntry } from 'src/app/models/furniture-window.models';
import { SetSelectedFurniture } from 'src/app/app.actions';
import { ToolSettingsService } from '../../services/tool-settings.service';
import { FurnitureLibraryService } from '../../services/furniture-library.service';
import { parseFurnitureGroups } from '../../utils/furniture-catalog-parser';
import { NATIVE_ZOOM_FACTORS } from '../../utils/native-camera';
import { TileSprite } from '../../utils/sheet-atlas';


@Component({
  selector: 'app-furniture-selection-menu',
  templateUrl: './furniture-selection-menu.component.html',
  styleUrls: ['./furniture-selection-menu.component.scss']
})
export class FurnitureSelectionMenuComponent implements OnInit, OnChanges, OnDestroy {
  constructor(private sanitizer: DomSanitizer, private db: DbService, private library: FurnitureLibraryService, private store: Store<fromRoot.State>, private settings: ToolSettingsService) { }
  @Input() tileEditing = false;
  @Input() embedded = false;
  @Input() group = '';
  @Input() zoom = .5;
  @Output() zoomChange = new EventEmitter<number>();
  zooms = NATIVE_ZOOM_FACTORS;
  private loadVersion = 0;
  private subscription?: Subscription;

  selectedTileset: string = 'walls_exterior_house_01';
  selectedFurnitureGroup: string = 'Advertising';

  tilesets: string[] = [];
  tiles: SvgTile[] = [];

  furnitureGroups: BFurnitureGroup[] = [];
  furnitureTiles: VisualFurniture[] = [];

  selectedFurniture: VisualFurniture | undefined;
  selectedFurnitureOrient: string;

  ngOnInit(): void {
    // Re-runs whenever the shared list changes, so admin edits show up without reopening the editor.
    this.subscription = this.library.groups$.subscribe(groups => {
      this.furnitureGroups = groups;
      const group = this.furnitureGroups.find(x => x.label === (this.group || this.getSelectedFurnitureGroup())) || this.furnitureGroups[0];
      if (group) this.setSelectedFurnitureGroup(group.label);
      else this.furnitureTiles = [];
    });
    this.library.load().catch(error => console.error('Could not load the furniture list.', error));

    this.getTilesets();
  }
  ngOnDestroy(): void { this.subscription?.unsubscribe(); }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['group'] && this.group && this.furnitureGroups.length) this.setSelectedFurnitureGroup(this.group);
  }

  parseCustomFile(content: string): BFurnitureGroup[] { return parseFurnitureGroups(content); }

  retTiles: SvgTile[] = [];
  
  // getFurnitureTiles(groupName: string): VisualFurniture[] {
  //   const group = this.furnitureGroups.find(x => x.label == groupName);
  //   this.retTiles = [];
  //   if(!group)
  //   {
  //     return [];
  //   }

  //   const ret: VisualFurniture[] = [];

  //   group.furniture.forEach((furniture) => {
  //     furniture.entries.forEach((entry) => {
  //       entry.items.forEach((item) => {
  //         console.log('checking', item.tile + ".png")
  //         console.log(this.tiles)
  //         const tile = this.tiles.find(x => x.name === item.tile + ".png");
  //         this.tiles.forEach((t) => {
  //           if(t.name === item.tile + ".png")
  //           {
  //             console.log('Matched', t.name, item.tile + ".png")
  //           }
  //           else
  //           {
  //             console.log('DID NOT MATCH', t.name, item.tile + ".png")
  //           }
  //         })
  //         if(tile)
  //         {
  //           console.log('Found', tile.name)
  //           this.retTiles.push({
  //             x: Number.parseInt(item.pos.split(',')[0]),
  //             y: Number.parseInt(item.pos.split(',')[1]),
  //             url: tile.url,
  //             layer: 'Furniture',
  //             level: 0
  //           })
  //         }
  //       })

  //       console.log('pushing', group.label)
  //       ret.push({
  //         orient: entry.orient,
  //         tiles: this.retTiles
  //       })
  //     })
  //   })

  //   console.log(ret)
  //   return ret;
  // }

  async getTilesets() {
    const ret =  await this.db.getTilesets();
    ret.forEach((tileset) => {
      this.tilesets.push(tileset.name);
    });
    return ret;
  }

  async getIndividualTiles(furnitureGroup: BFurnitureGroup) {
    const version = ++this.loadVersion;
    this.tiles = [];
    this.furnitureTiles = [];
    // Sprites come straight from the stored sheets, so nothing is cut out or re-encoded per tile.
    const sprites = new Map<string, Promise<TileSprite | null>>();
    for (const furniture of furnitureGroup.furniture) for (const entry of furniture.entries) for (const item of entry.items) {
      if (!sprites.has(item.tile)) sprites.set(item.tile, this.db.getTileSprite(item.tile + '.png').catch(error => {
        console.error('Error fetching tile:', error);
        return null;
      }));
    }
    const resolved = new Map(await Promise.all([...sprites].map(async ([name, sprite]) => [name, await sprite] as const)));
    if (version !== this.loadVersion) return;

    const layer = this.getSelectedLayer(), level = this.getSelectedLevel();
    const tiles: SvgTile[] = [];
    this.furnitureTiles = furnitureGroup.furniture.map(furniture => ({
      layer: furniture.layer,
      corners: furniture.corners,
      entries: furniture.entries.map(entry => {
        let xSize = 0, ySize = 0;
        const entryTiles: SvgTile[] = [];
        for (const item of entry.items) {
          const sprite = resolved.get(item.tile);
          if (!sprite) continue;
          const [x, y] = item.pos.split(',').map(value => Number.parseInt(value));
          xSize = Math.max(xSize, x); ySize = Math.max(ySize, y);
          entryTiles.push({ name: item.tile + '.png', url: '', sprite, x, y, layer, level });
        }
        tiles.push(...entryTiles);
        return { orient: entry.orient, grime: entry.grime, tiles: entryTiles, xSize, ySize };
      }),
    }));
    this.tiles = tiles;
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
    //this.getIndividualTiles(tileset);
  }

  getSelectedTileset(): string {
    return localStorage.getItem('selectedTileset') || 'walls_exterior_house_01';
  }

  setSelectedFurnitureGroup(group: string) {
    localStorage.setItem('selectedFurnitureGroup', group);
    this.selectedFurnitureGroup = group;

    const fGroup = this.furnitureGroups.find(x => x.label == group);

    if(fGroup)
    {
      this.getIndividualTiles(fGroup)//.then(() => {
        //this.furnitureTiles = this.getFurnitureTiles(group);
      //});
    }
  }

  getSelectedFurnitureGroup(): string {
    return localStorage.getItem('selectedFurnitureGroup') || 'Advertising';
  }

  setSelectedFurniture(group: VisualFurniture, orient: string) {
    this.selectedFurniture = group;
    this.selectedFurnitureOrient = orient;
    if (this.tileEditing) {
      const tiles = group.entries.find(entry => entry.orient === orient)?.tiles || [];
      if (!tiles.length) return;
      const x = Math.min(...tiles.map(tile => tile.x)), y = Math.min(...tiles.map(tile => tile.y));
      this.settings.stamp = { width: Math.max(...tiles.map(tile => tile.x)) - x + 1,
        height: Math.max(...tiles.map(tile => tile.y)) - y + 1,
        cells: tiles.map(tile => ({ x: tile.x - x, y: tile.y - y, tile: tile.name! })) };
      this.settings.tileMode = 'brush';
      return;
    }
    this.store.dispatch(new SetSelectedFurniture(group, orient));
  }

  //Helper functions
  abs(a: number): number {
    return Math.abs(a);
  }
}
