import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';
import { AddObject, SetBuilding, Undo, Redo } from '../../app.actions';
import { RoofService } from '../../services/roof.service';
import { TileEntry } from '../../models/app.models';
import { BuildingService } from '../../services/building.service';
import { BuildingTilesLibraryService } from '../../services/building-tiles-library.service';
import { DbService } from '../../services/db.service';
import { FurnitureLibraryService } from '../../services/furniture-library.service';
import { GridService } from '../../services/grid.service';
import { RoomTileLibraryService } from '../../services/room-tile-library.service';
import { ToolSettingsService } from '../../services/tool-settings.service';
import { DoorService } from '../../services/door.service';
import { WindowService } from '../../services/window.service';
import { documentHarness } from '../../testing/document-harness';
import { nativeBuildingXml } from '../../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../../utils/tbx-format';
import { emptyIndexGrid, writeIndexGrid } from '../../utils/tbx-grid';
import ToolWall from '../../tools/tool-wall';
import ToolStairs from '../../tools/tool-stairs';
import { generateBuildingSquares } from '../../services/native-squares';
import { TilesFurnitureSidebarComponent } from './tiles-furniture-sidebar.component';

function material(category: string, name: string): TileEntry {
  const enums = category === 'stairs' ? ['West1', 'West2', 'West3', 'North1', 'North2', 'North3'] : ['West', 'North', 'NorthWest', 'SouthEast', 'WestDoor', 'NorthDoor'];
  return { category, tiles: enums.map(value => ({ enum: value, tile: `${name}-${value}` })) };
}
describe('Tiles and Furniture material sidebar', () => {
  let h: ReturnType<typeof documentHarness>, settings: ToolSettingsService, saved: string, materials: BehaviorSubject<TileEntry[]>;
  const defaults = [material('exterior_walls', 'outside'), material('interior_walls', 'inside'),
    material('exterior_wall_trim', 'outertrim'), material('interior_wall_trim', 'innertrim'),
    material('stairs', 'stairs'), material('doors', 'door'), material('door_frames', 'frame'),
    material('windows', 'window'), material('curtains', 'curtain'), material('shutters', 'shutter')];
  beforeEach(() => {
    saved = JSON.stringify(localStorage); localStorage.clear();
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    b.width = b.height = 8; b.floors = [{ rooms: writeIndexGrid(emptyIndexGrid(8, 8)), objects: [] }];
    h = documentHarness(b); settings = new ToolSettingsService();
    materials = new BehaviorSubject<TileEntry[]>(defaults);
    TestBed.configureTestingModule({ declarations: [TilesFurnitureSidebarComponent], imports: [CommonModule, FormsModule], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [
      { provide: Store, useValue: h.store }, { provide: BuildingService, useValue: h.buildings },
      { provide: GridService, useValue: h.grid }, { provide: ToolSettingsService, useValue: settings },
      { provide: RoomTileLibraryService, useValue: { load: async () => [] } },
      { provide: BuildingTilesLibraryService, useValue: { entries$: materials, load: async () => ({}) } },
      { provide: DbService, useValue: { getTile: async () => undefined } },
      { provide: FurnitureLibraryService, useValue: { groups$: of([{ label: 'Seating', furniture: [] }]), load: async () => ({}) } }
    ] });
  });
  afterEach(() => { h.destroy(); localStorage.clear(); Object.entries(JSON.parse(saved)).forEach(([key, value]) => localStorage.setItem(key, value as string)); });
  async function setup() {
    const fixture = TestBed.createComponent(TilesFurnitureSidebarComponent);
    fixture.componentRef.setInput('tool', 'tool-wall'); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return { fixture, sidebar: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
  }
  it('shows full-catalog category thumbnails and preserves the sidebar selection across placement tools', async () => {
    const { fixture, sidebar, element } = await setup();
    expect(element.querySelector('[aria-label="Tile and furniture categories"]')?.textContent).toContain('Exterior Wall Trim');
    expect(element.querySelector('[aria-label="outside-West"]')).not.toBeNull();
    sidebar.selectCategory('stairs'); fixture.detectChanges();
    expect(element.querySelector('[aria-label="stairs-West1"]')).not.toBeNull();
    fixture.componentRef.setInput('tool', 'tool-door'); fixture.detectChanges();
    expect(sidebar.category).toBe('stairs');
    fixture.destroy();
  });
  it('keeps the scrolled material list and focused thumbnail in place when changing exterior walls and undoing', async () => {
    const entries = Array.from({ length: 32 }, (_, index): TileEntry => ({ category: 'exterior_walls',
      tiles: ['West', 'North', 'NorthWest', 'SouthEast'].map((value, offset) => ({ enum: value,
        tile: `walls_exterior_01_${String(index * 8 + offset).padStart(3, '0')}` })) }));
    materials.next(entries);
    const { fixture, element } = await setup();
    fixture.componentRef.setInput('tool', 'tool-draw-room');
    element.style.width = '300px'; element.style.height = '500px'; fixture.detectChanges();
    const list = element.querySelector('.material-list') as HTMLElement;
    const button = list.querySelector(`[aria-label="${entries[12].tiles[0].tile}"]`) as HTMLButtonElement;
    const section = button.closest('section');
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    list.scrollTop = 400; const scrollTop = list.scrollTop;
    expect(scrollTop).toBeGreaterThan(0);
    button.focus({ preventScroll: true }); button.click(); fixture.detectChanges();
    expect(list.scrollTop).toBe(scrollTop);
    expect(button.closest('section')).toBe(section);
    expect(list.querySelector(`[aria-label="${entries[12].tiles[0].tile}"]`)).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    h.store.dispatch(new Undo()); fixture.detectChanges();
    expect(list.scrollTop).toBe(scrollTop); expect(document.activeElement).toBe(button);
    h.store.dispatch(new Redo()); fixture.detectChanges();
    expect(list.scrollTop).toBe(scrollTop); expect(document.activeElement).toBe(button);
    fixture.destroy();
  });
  it('keeps four wall choices in the palette and registers them atomically with placement, including after undo', async () => {
    const { fixture, sidebar } = await setup(); const before = h.buildings.building;
    defaults.slice(0, 4).forEach(entry => { sidebar.selectCategory(entry.category); sidebar.choose(entry); });
    expect(h.buildings.building).toBe(before); expect(h.state.value.past.length).toBe(0);
    const tool = new ToolWall(h.buildings, h.grid, h.store as any, settings);
    tool.beginDrag(1, 1); tool.hoverTile(4, 1); expect(tool.tileGhosts.some(tile => tile.name?.startsWith('outside-'))).toBeTrue(); tool.endDrag(4, 1);
    const after = h.buildings.building, wall = after.floors[0].objects[0];
    expect(after.entries[wall.Tile - 1]).toEqual(defaults[0]);
    expect(after.entries[wall.InteriorTile - 1]).toEqual(defaults[1]);
    expect(after.entries[wall.ExteriorTrim - 1]).toEqual(defaults[2]);
    expect(after.entries[wall.InteriorTrim - 1]).toEqual(defaults[3]);
    expect(after.ExteriorWall).toBe(before.ExteriorWall); expect(h.state.value.past.length).toBe(1);
    h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
    tool.beginDrag(1, 1); tool.endDrag(4, 1);
    expect(h.buildings.building.entries[h.buildings.building.floors[0].objects[0].Tile - 1]).toEqual(defaults[0]);
    fixture.destroy();
  });
  it('changes room-generated exterior walls on every floor in one undoable edit while the room tool is active', async () => {
    const old = material('exterior_walls', 'old-outside'), inside = material('interior_walls', 'room-inside');
    const building = h.buildings.building;
    building.entries = [...building.entries, old, inside];
    building.ExteriorWall = building.entries.length - 1;
    building.rooms[0].InteriorWall = building.entries.length;
    const rooms = emptyIndexGrid(8, 8); rooms[1][1] = rooms[1][2] = rooms[2][1] = rooms[2][2] = 1;
    building.floors = [0, 1].map(() => ({ rooms: writeIndexGrid(rooms), objects: [] }));
    building.floors[0].objects.push({ uid: 'custom-wall', type: 'wall', x: 6, y: 6, dir: 'W', length: 1,
      Tile: building.ExteriorWall, InteriorTile: building.rooms[0].InteriorWall, ExteriorTrim: 0, InteriorTrim: 0 });
    h.store.dispatch(new SetBuilding(building));
    const { fixture, sidebar } = await setup();
    sidebar.selectCategory('exterior_walls');
    settings.wallMaterials = { Tile: old };
    fixture.componentRef.setInput('tool', 'tool-draw-room'); fixture.detectChanges();
    const before = h.buildings.building;
    expect(sidebar.selectedEntry).toEqual(old);
    sidebar.choose(defaults[0]);
    const changed = h.buildings.building;
    expect(changed.entries[changed.ExteriorWall - 1]).toEqual(defaults[0]);
    expect(h.state.value.past.length).toBe(1);
    expect(changed.floors).toBe(before.floors);
    for (const level of [0, 1]) {
      const generated = generateBuildingSquares(changed).tiles;
      expect(generated.some(tile => tile.level === level && tile.name?.startsWith('outside-'))).toBeTrue();
      expect(generated.some(tile => tile.level === level && tile.name?.startsWith('room-inside-'))).toBeTrue();
      expect(generated.some(tile => tile.level === level && tile.name?.startsWith('old-outside-') && tile.x < 6)).toBeFalse();
    }
    expect(sidebar.selectedEntry).toEqual(defaults[0]);
    sidebar.choose(defaults[0]); expect(h.state.value.past.length).toBe(1);
    h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before); expect(sidebar.selectedEntry).toEqual(old);
    h.store.dispatch(new Redo()); expect(h.buildings.building).toBe(changed);
    const reopened = readBuildingFile(writeBuildingFile(changed));
    expect(reopened.entries[reopened.ExteriorWall - 1]).toEqual(defaults[0]);
    fixture.componentRef.setInput('tool', 'tool-wall'); fixture.detectChanges();
    expect(sidebar.selectedEntry).toEqual(old);
    fixture.destroy();
  });

  it('supports None as the room exterior wall without changing room definitions or manual wall objects', async () => {
    const { fixture, sidebar } = await setup();
    fixture.componentRef.setInput('tool', 'tool-draw-room'); fixture.detectChanges();
    sidebar.selectCategory('exterior_walls'); sidebar.choose(defaults[0]);
    const before = h.buildings.building;
    sidebar.choose(null);
    expect(h.buildings.building.ExteriorWall).toBe(0);
    expect(h.buildings.building.rooms).toBe(before.rooms);
    expect(h.buildings.building.floors).toBe(before.floors);
    expect(sidebar.selectedEntry).toBeNull();
    h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
    fixture.destroy();
  });
  it('uses selected stairs, door, frame, window, curtain and shutter entries for new objects and saves them to TBX', async () => {
    const { fixture, sidebar } = await setup();
    defaults.slice(4).forEach(entry => { sidebar.selectCategory(entry.category); sidebar.choose(entry); });
    const stairs = new ToolStairs(h.buildings, h.grid, h.store as any, settings);
    stairs.hoverTile(1, 1, 'N'); stairs.beginDrag(1, 1); stairs.endDrag(1, 1);
    const doors = new DoorService(h.grid, h.buildings, h.store as any);
    const windows = new WindowService(h.grid, h.buildings, h.store as any);
    expect(doors.getTile('N')).toBe('door-North'); expect(windows.getTile('W')).toBe('window-West');
    doors.placeDoor(2, 2, 0, 'N'); windows.placeWindow(3, 3, 0, 'W');
    const b = h.buildings.building, objects = b.floors[0].objects;
    expect(objects.find(object => object.type === 'stairs')?.Tile).toBe(b.Stairs);
    expect(objects.find(object => object.type === 'door')?.FrameTile).toBe(b.DoorFrame);
    expect(objects.find(object => object.type === 'window')?.CurtainsTile).toBe(b.Curtains);
    expect(objects.find(object => object.type === 'window')?.ShuttersTile).toBe(b.Shutters);
    expect(readBuildingFile(writeBuildingFile(b)).entries).toEqual(b.entries); fixture.destroy();
  });
  it('supports None and undo/redo of default choices without rewriting existing objects', async () => {
    const { fixture, sidebar } = await setup(); sidebar.selectCategory('doors'); sidebar.choose(defaults[5]);
    const doors = new DoorService(h.grid, h.buildings, h.store as any); doors.placeDoor(1, 1, 0, 'W');
    const before = h.buildings.building, door = before.floors[0].objects[0];
    sidebar.choose(null); expect(h.buildings.building.Door).toBe(0); expect(h.buildings.building.floors[0].objects[0]).toBe(door);
    h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
    h.store.dispatch(new Redo()); expect(h.buildings.building.Door).toBe(0);
    sidebar.selectCategory('exterior_walls'); sidebar.choose(null); expect(settings.wallMaterials['Tile']).toBeNull();
    fixture.destroy();
  });
  it('puts roof categories last and uses native preview slots, roof defaults and undoable cap/slope changes', async () => {
    const entries: TileEntry[] = [
      { category: 'roof_caps', tiles: [{ enum: 'CapRiseE3', tile: 'cap_002' }] },
      { category: 'roof_slopes', tiles: [{ enum: 'SlopeS2', tile: 'slope_001' }] },
      { category: 'roof_tops', tiles: [{ enum: 'West2', tile: 'top_001' }] }
    ];
    materials.next([...defaults, ...entries]);
    const { fixture, sidebar, element } = await setup();
    expect(sidebar.categories.slice(-3).map(category => category.label)).toEqual(['Roof Caps', 'Roof Slopes', 'Roof Tops']);
    h.store.dispatch(new AddObject({ uid: 'roof', type: 'roof', x: 1, y: 1, width: 2, height: 2,
      RoofType: 'Flat', Depth: 'One', CapTiles: 0, SlopeTiles: 0, TopTiles: 0 }, 0));
    const before = h.buildings.building;
    entries.forEach(entry => {
      sidebar.selectCategory(entry.category); fixture.detectChanges();
      expect(element.querySelector(`[aria-label="${sidebar.display(entry)}"]`)).not.toBeNull();
      if (entry.category !== 'roof_tops') expect(sidebar.groups.flatMap(group => group.entries)).not.toContain(null);
      sidebar.choose(entry);
    });
    const building = h.buildings.building, roof = building.floors[0].objects[0];
    expect(roof.CapTiles).toBe(building.RoofCap); expect(roof.SlopeTiles).toBe(building.RoofSlope);
    expect(roof.TopTiles).toBe(0);
    const service = new RoofService(h.buildings, h.grid, h.store as any), next = service.createObject(3, 3, 'Flat');
    expect([next.CapTiles, next.SlopeTiles, next.TopTiles]).toEqual([building.RoofCap, building.RoofSlope, building.RoofTop]);
    h.store.dispatch(new Undo()); h.store.dispatch(new Undo()); h.store.dispatch(new Undo());
    expect(h.buildings.building).toBe(before);
    fixture.destroy();
  });
});
