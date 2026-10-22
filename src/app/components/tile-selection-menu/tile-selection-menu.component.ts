import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Store } from '@ngrx/store';
import { liveQuery, Subscription } from 'dexie';
import { ScheduleRedraw } from '../../app.actions';
import * as fromRoot from '../../app.reducers';
import { DbService, PngTile } from '../../services/db.service';
import { GridService } from '../../services/grid.service';
import { ToolSettingsService } from '../../services/tool-settings.service';
import { NATIVE_ZOOM_FACTORS } from '../../utils/native-camera';

@Component({
  selector: 'app-tile-selection-menu',
  templateUrl: './tile-selection-menu.component.html',
  styleUrls: ['./tile-selection-menu.component.scss']
})
export class TileSelectionMenuComponent implements OnInit, OnDestroy, AfterViewInit {
  constructor(private db: DbService, public settings: ToolSettingsService,
    public grid: GridService, private store: Store<fromRoot.State>, private zone: NgZone) { }
  tab: 'tilesets' | 'furniture' = 'tilesets';
  selectedTileset = localStorage.getItem('selectedTileset') || 'walls_exterior_house_01';
  tilesets: string[] = [];
  tiles: (PngTile | undefined)[] = [];
  searchTerm = '';
  zooms = NATIVE_ZOOM_FACTORS;
  zoom = Number(localStorage.getItem('tileDockZoom')) || .5;
  background = localStorage.getItem('tileDockBackground') || '#ffffff';
  autoSwitchLayer = localStorage.getItem('tileDockAutoSwitch') !== 'false';
  defaultLayers: Record<string, string> = JSON.parse(localStorage.getItem('tileDefaultLayers') || '{}');
  contextTile: string | undefined;
  selectedTiles = new Set<string>();
  private anchor = 0;
  @ViewChild('layerList') layerList?: ElementRef<HTMLElement>;
  private subscriptions: { unsubscribe(): void }[] = [];
  private tileSubscription?: Subscription;
  get cellWidth(): number { return (128 + (this.autoSwitchLayer ? 16 : 0)) * this.zoom + 2; }
  get cellHeight(): number { return 256 * this.zoom + 2 + (this.autoSwitchLayer ? 16 : 0); }
  // Native layer stack, displayed from top to bottom.
  layers = ['RoofTop', 'Roof2', 'Roof', 'WallOverlay4', 'WallOverlay3', 'WallFurniture4', 'WallFurniture3',
    'Curtains2', 'Furniture4', 'Furniture3', 'Furniture2', 'Furniture', 'Curtains', 'Windows', 'Doors', 'Frames',
    'WallFurniture2', 'WallFurniture', 'WallGrime2', 'WallGrime', 'WallOverlay2', 'WallOverlay', 'RoofCap2',
    'RoofCap', 'WallTrim2', 'Walls2', 'WallTrim', 'Walls', 'Vegetation', 'FloorFurniture', 'FloorGrime2',
    'FloorGrime', 'FloorOverlay', 'Floor'];
  ngOnInit(): void {
    this.subscriptions.push(this.grid.selectedLevelChanges.subscribe(() => this.scrollToLayer()));
    this.subscriptions.push(this.settings.pickedTileChanges.subscribe(name => {
      const sheet = name.replace(/_[0-9]+\.png$/, '');
      if (this.tilesets.includes(sheet)) {
        this.searchTerm = ''; this.tab = 'tilesets'; this.setSelectedTileset(sheet);
        const layer = this.defaultLayers[name];
        if (this.autoSwitchLayer && this.layers.includes(layer)) this.setSelectedLayer(layer);
      }
    }));
    this.subscriptions.push(liveQuery(() => this.db.getTilesets()).subscribe(sheets => this.zone.run(() => {
      this.tilesets = sheets.map(sheet => sheet.name).sort();
      if (!this.tilesets.includes(this.selectedTileset)) this.selectedTileset = this.tilesets[0] || '';
      this.filterChanged();
      this.setSelectedTileset(this.selectedTileset);
    })));
  }
  ngAfterViewInit(): void { this.scrollToLayer(); }
  private scrollToLayer(): void {
    const row = Array.from(this.layerList?.nativeElement.querySelectorAll<HTMLElement>('[data-layer]') || [])
      .find(element => element.dataset['layer'] === this.getSelectedLayer());
    row?.scrollIntoView({ block: 'nearest' });
  }
  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
    this.tileSubscription?.unsubscribe();
  }
  getFilteredTilesets(): string[] {
    return this.tilesets.filter(name => name.toLowerCase().includes(this.searchTerm.trim().toLowerCase()));
  }
  filterChanged(): void {
    const visible = this.getFilteredTilesets();
    if (visible.includes(this.selectedTileset)) return;
    const index = this.tilesets.indexOf(this.selectedTileset);
    const previous = visible.filter(name => this.tilesets.indexOf(name) < index);
    this.setSelectedTileset(previous[previous.length - 1] || visible[0] || '');
  }
  setSelectedTileset(name: string): void {
    this.tileSubscription?.unsubscribe();
    this.selectedTileset = name;
    this.tiles = [];
    this.selectedTiles.clear();
    this.anchor = 0;
    if (!name) return;
    localStorage.setItem('selectedTileset', name);
    this.tileSubscription = liveQuery(() => this.db.getTiles(name)).subscribe(tiles => this.zone.run(() => {
      // Keep original eight-column sheet coordinates, including any missing indices.
      const indexed = tiles.map(tile => ({ tile, index: Number(tile.name.match(/_([0-9]+)\.png$/)?.[1]) }));
      const count = Math.max(0, ...indexed.filter(value => Number.isFinite(value.index)).map(value => value.index + 1));
      this.tiles = Array(Math.ceil(count / 8) * 8).fill(undefined);
      indexed.forEach(({ tile, index }) => { if (Number.isFinite(index)) this.tiles[index] = tile; });
    }));
  }
  getSelectedTile(): string { return localStorage.getItem('selectedTile') || 'walls_exterior_house_01_0.png'; }
  getSelectedLayer(): string { return localStorage.getItem('selectedLayer') || 'Walls'; }
  setSelectedLayer(layer: string): void { localStorage.setItem('selectedLayer', layer); this.scrollToLayer(); }
  selectTile(tile: PngTile, index: number, event: MouseEvent): void {
    if (event.shiftKey) {
      this.selectedTiles.clear();
      const left = Math.min(this.anchor % 8, index % 8), right = Math.max(this.anchor % 8, index % 8);
      const top = Math.min(Math.floor(this.anchor / 8), Math.floor(index / 8));
      const bottom = Math.max(Math.floor(this.anchor / 8), Math.floor(index / 8));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const name = this.tiles[y * 8 + x]?.name;
        if (name) this.selectedTiles.add(name);
      }
    } else {
      if (!event.ctrlKey && !event.metaKey) this.selectedTiles.clear();
      if (this.selectedTiles.has(tile.name)) this.selectedTiles.delete(tile.name);
      else this.selectedTiles.add(tile.name);
      this.anchor = index;
    }
    localStorage.setItem('selectedTile', tile.name);
    const layer = this.defaultLayers[tile.name];
    if (this.autoSwitchLayer && this.layers.includes(layer)) this.setSelectedLayer(layer);
    const selected = this.tiles.flatMap((value, i) => value && this.selectedTiles.has(value.name)
      ? [{ x: i % 8, y: Math.floor(i / 8), tile: value.name }] : []);
    this.settings.stamp = undefined;
    if (selected.length > 1) {
      const x = Math.min(...selected.map(cell => cell.x)), y = Math.min(...selected.map(cell => cell.y));
      this.settings.stamp = { width: Math.max(...selected.map(cell => cell.x)) - x + 1,
        height: Math.max(...selected.map(cell => cell.y)) - y + 1,
        cells: selected.map(cell => ({ ...cell, x: cell.x - x, y: cell.y - y })) };
      this.settings.tileMode = 'brush';
    }
  }
  tileSelected(name: string): boolean {
    return this.selectedTiles.size > 1 ? this.selectedTiles.has(name) : this.getSelectedTile() === name;
  }
  setDefaultLayer(layer: string): void {
    const names = this.contextTile && this.selectedTiles.has(this.contextTile) ? [...this.selectedTiles] : [this.contextTile!];
    names.forEach(name => { this.defaultLayers[name] = layer; });
    localStorage.setItem('tileDefaultLayers', JSON.stringify(this.defaultLayers));
    this.contextTile = undefined;
  }
  setZoom(value: number): void { this.zoom = value; localStorage.setItem('tileDockZoom', String(value)); }
  setBackground(value: string): void { this.background = value; localStorage.setItem('tileDockBackground', value); }
  toggleAutoSwitch(): void {
    this.autoSwitchLayer = !this.autoSwitchLayer;
    localStorage.setItem('tileDockAutoSwitch', String(this.autoSwitchLayer));
  }
  get opacity(): number { return Math.round(this.grid.layerView(this.getSelectedLayer()).opacity * 100); }
  get visibility(): number {
    const top = this.layers.findIndex(layer => this.grid.layerView(layer).visible);
    return top < 0 ? 0 : this.layers.length - top - 1;
  }
  setOpacity(value: number): void {
    this.grid.setLayerView(this.getSelectedLayer(), { opacity: value / 100 }); this.redraw();
  }
  setVisible(layer: string, visible: boolean): void { this.grid.setLayerView(layer, { visible }); this.redraw(); }
  setVisibility(value: number): void {
    this.layers.forEach((layer, index) => this.grid.setLayerView(layer, { visible: this.layers.length - index - 1 <= value }));
    this.redraw();
  }
  private redraw(): void { this.store.dispatch(new ScheduleRedraw(true)); }
}
