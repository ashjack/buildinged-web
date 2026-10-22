import { Component, Input, OnChanges, OnDestroy, OnInit, NgZone } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import * as fromRoot from '../../app.reducers';
import { ScheduleRedraw, SetBuildingMaterial } from '../../app.actions';
import { Building, TileEntry } from '../../models/app.models';
import { BFurnitureGroup } from '../../models/furniture-window.models';
import { BuildingService } from '../../services/building.service';
import { DbService } from '../../services/db.service';
import { GridService } from '../../services/grid.service';
import { RoomTileLibraryService } from '../../services/room-tile-library.service';
import { ToolSettingsService } from '../../services/tool-settings.service';
import { NATIVE_ZOOM_FACTORS } from '../../utils/native-camera';
import { roomEntryKey, cloneRoomEntry } from '../../utils/room-tile-entries';
import { BuildingMaterialField } from '../../utils/object-materials';

interface MaterialCategory {
  category: string; label: string; wall?: string;
  setting?: 'exterior' | 'interior' | 'exteriorTrim' | 'interiorTrim';
  fallback?: 'ExteriorWall' | 'ExteriorWallTrim';
  room?: 'InteriorWall' | 'InteriorWallTrim'; field?: BuildingMaterialField;
}
export const OBJECT_MATERIALS: MaterialCategory[] = [
  { category: 'exterior_walls', label: 'Exterior Walls', wall: 'Tile', setting: 'exterior', fallback: 'ExteriorWall' },
  { category: 'interior_walls', label: 'Interior Walls', wall: 'InteriorTile', setting: 'interior', room: 'InteriorWall' },
  { category: 'exterior_wall_trim', label: 'Exterior Wall Trim', wall: 'ExteriorTrim', setting: 'exteriorTrim', fallback: 'ExteriorWallTrim' },
  { category: 'interior_wall_trim', label: 'Interior Wall Trim', wall: 'InteriorTrim', setting: 'interiorTrim', room: 'InteriorWallTrim' },
  { category: 'doors', label: 'Doors', field: 'Door' },
  { category: 'door_frames', label: 'Door Frames', field: 'DoorFrame' },
  { category: 'windows', label: 'Windows', field: 'Window' },
  { category: 'curtains', label: 'Curtains', field: 'Curtains' },
  { category: 'shutters', label: 'Shutters', field: 'Shutters' },
  { category: 'stairs', label: 'Stairs', field: 'Stairs' },
  { category: 'roof_caps', label: 'Roof Caps', field: 'RoofCap' },
  { category: 'roof_slopes', label: 'Roof Slopes', field: 'RoofSlope' },
  { category: 'roof_tops', label: 'Roof Tops', field: 'RoofTop' }
];

@Component({ selector: 'app-tiles-furniture-sidebar', templateUrl: './tiles-furniture-sidebar.component.html', styleUrls: ['./tiles-furniture-sidebar.component.scss'] })
export class TilesFurnitureSidebarComponent implements OnInit, OnChanges, OnDestroy {
  @Input() tool = '';
  readonly categories = OBJECT_MATERIALS;
  readonly zooms = NATIVE_ZOOM_FACTORS;
  readonly key = roomEntryKey;
  zoom = Number(localStorage.getItem('tileDockZoom')) || .5;
  category = '';
  furnitureGroup = localStorage.getItem('selectedFurnitureGroup') || 'Advertising';
  furnitureGroups: BFurnitureGroup[] = [];
  groups: { name: string; entries: (TileEntry | null)[] }[] = [];
  building: Building | undefined;
  private defaults: TileEntry[] = [];
  private images = new Map<string, string>();
  private subscriptions = new Subscription();
  private destroyed = false;
  error = '';
  constructor(private store: Store<fromRoot.State>, private buildings: BuildingService, private library: RoomTileLibraryService,
    private db: DbService, private grid: GridService, public settings: ToolSettingsService, private zone: NgZone) { }
  ngOnChanges(): void {
    if (!this.category) this.category = localStorage.getItem('tilesFurnitureCategory') ||
      (this.tool === 'tool-stairs' ? 'stairs' : this.tool === 'tool-door' ? 'doors' : this.tool === 'tool-window' ? 'windows' : this.tool === 'tool-furniture' ? 'furniture' : 'exterior_walls');
  }
  ngOnInit(): void {
    this.subscriptions.add(this.store.select(fromRoot.getBuilding).subscribe(building => { this.building = building; this.rebuild(); }));
    Promise.all([this.buildings.getCategoryTileEntries(), this.library.load()]).then(([defaults, custom]) => {
      if (this.destroyed) return;
      this.defaults = [...defaults, ...custom]; this.rebuild();
    }).catch(() => { this.error = 'Could not load default tiles.'; });
  }
  ngOnDestroy(): void { this.destroyed = true; this.subscriptions.unsubscribe(); }
  selectCategory(category: string): void {
    this.category = category; localStorage.setItem('tilesFurnitureCategory', category); this.rebuild();
  }
  selectFurniture(group: string): void {
    this.furnitureGroup = group; this.selectCategory('furniture');
  }
  display(entry: TileEntry | null): string {
    const slot: Record<string, string> = { stairs: 'West1', shutters: 'NorthLeft', roof_caps: 'CapRiseE3', roof_slopes: 'SlopeS2', roof_tops: 'West2' };
    return entry?.tiles.find(tile => tile.enum === (slot[entry.category] || 'West'))?.tile || 'None';
  }
  private rebuild(): void {
    const entries = new Map<string, TileEntry>();
    [...this.defaults, ...(this.building?.entries || [])].filter(entry => entry.category === this.category)
      .forEach(entry => entries.set(this.key(entry), entry));
    const groups = new Map<string, (TileEntry | null)[]>();
    if (!['roof_caps', 'roof_slopes'].includes(this.category)) groups.set('', [null]);
    [...entries.values()].sort((a, b) => this.display(a).localeCompare(this.display(b))).forEach(entry => {
      const name = this.display(entry).replace(/_[0-9]+$/, '');
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(entry);
    });
    this.groups = [...groups].map(([name, entries]) => ({ name, entries }));
  }
  image(entry: TileEntry | null): string {
    const tile = this.display(entry);
    if (tile === 'None') return 'assets/icons/none-tile.png';
    const name = tile.replace(/\.png$/, '') + '.png';
    if (!this.images.has(name)) {
      this.images.set(name, 'assets/icons/missing-tile.png');
      this.db.getTile(name).then(result => { if (result && !this.destroyed) this.zone.run(() => this.images.set(name, result.url)); }).catch(() => {});
    }
    return this.images.get(name)!;
  }
  get selectedEntry(): TileEntry | null {
    const category = this.categories.find(item => item.category === this.category);
    const b = this.building;
    if (!category || !b) return null;
    if (category.wall && category.wall in this.settings.wallMaterials) return this.settings.wallMaterials[category.wall];
    const id = category.wall ? (this.settings[category.setting!] ??
      (category.room ? b.rooms[0]?.[category.room] : b[category.fallback!])) :
      category.field === 'Stairs' ? (this.settings.stairs ?? b.Stairs) : b[category.field!];
    return b.entries[Number(id) - 1] || null;
  }
  selected(entry: TileEntry | null): boolean {
    const current = this.selectedEntry;
    return entry && current ? this.key(entry) === this.key(current) : entry === current;
  }
  choose(entry: TileEntry | null): void {
    const category = this.categories.find(item => item.category === this.category);
    if (!category || !this.building || (entry && entry.category !== category.category)) return;
    if (!entry && ['roof_caps', 'roof_slopes'].includes(category.category)) return;
    if (category.wall) {
      this.settings.wallMaterials = { ...this.settings.wallMaterials, [category.wall]: entry ? cloneRoomEntry(entry) : null };
    } else {
      if (category.field === 'Stairs') this.settings.stairs = null;
      this.store.dispatch(new SetBuildingMaterial(category.field!, entry, this.grid.getSelectedLevel()));
    }
    this.store.dispatch(new ScheduleRedraw(true));
  }
  setZoom(value: number): void { this.zoom = value; localStorage.setItem('tileDockZoom', String(value)); }
}
