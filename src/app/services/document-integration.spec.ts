import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Action, Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { RootEffects } from '../app.effects';
import { reducer, State } from '../app.reducers';
import { ActionsUnion, ActionTypes, AddObject, AddTile, EditRooms, Redo, RemoveObject, RemoveTile, SetBuilding, SetCurrentTool, Undo, UpdateObject } from '../app.actions';
import { Building } from '../models/app.models';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { readIndexGrid, writeIndexGrid, emptyIndexGrid } from '../utils/tbx-grid';
import ToolTile from '../tools/tool-tile';
import ToolDrawRoom from '../tools/tool-draw-room';
import ToolDoor from '../tools/tool-door';
import ToolWindow from '../tools/tool-window';
import { DoorService } from './door.service';
import { WindowService } from './window.service';
import { BuildingService } from './building.service';
import { GridService } from './grid.service';
import { DbService } from './db.service';
import { CacheService } from './cache.service';
import { TileService } from './tile.service';

function sceneBuilding(): Building {
    const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    const wallEnums = ['West', 'North', 'NorthWest', 'SouthEast', 'WestWindow', 'NorthWindow', 'WestDoor', 'NorthDoor'];
    building.entries.push(
        { category: 'floors', tiles: [{ enum: 'Floor', tile: 'floors_interior_tilesandwood_01_019' }] },
        { category: 'exterior_walls', tiles: wallEnums.map((value, index) => ({ enum: value, tile: 'walls_exterior_house_01_' + String(index).padStart(3, '0') })) },
        { category: 'interior_walls', tiles: wallEnums.map((value, index) => ({ enum: value, tile: 'walls_interior_house_01_' + String(index).padStart(3, '0') })) },
    );
    building.ExteriorWall = 3;
    building.rooms[0] = { ...building.rooms[0], InteriorWall: 4, Floor: 2 };
    building.floors[0].objects = [];
    building.floors[0].tileLayers = [];
    return building;
}

function freeze(value: any): void {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
}

describe('Authoritative document and scene integration', () => {
    it('derives rooms, tiles and object projections from a frozen document without mutating it', () => {
        const scene = documentHarness(sceneBuilding());
        freeze(scene.buildings.building);
        const before = JSON.stringify(scene.buildings.building);
        scene.grid.userTiles = [];
        scene.rooms.rooms = [];
        scene.buildings.renderBuilding(scene.buildings.building);
        expect(JSON.stringify(scene.buildings.building)).toBe(before);
        expect(scene.rooms.getRoomFromTile(0, 0, 0)?.room).toBe(scene.buildings.building.rooms[0]);
        const latest = scene.buildings.building;
        scene.store.dispatch(new EditRooms({ x: 1, y: 0, width: 1, height: 1 }, 0, 1));
        expect(scene.buildings.building).not.toBe(latest);
        expect(scene.buildings.building).toBe(scene.state.value.building!);
        expect(scene.rooms.getRoomFromTile(1, 0, 0)).not.toBeNull();
        scene.destroy();
    });

    it('deletes one overlapping object by UID, restores walls and keeps manual tiles and other floors', () => {
        const building = sceneBuilding();
        building.floors[0].objects = [
            { uid: 'door-a', type: 'door', x: '0', y: '0', dir: 'W', Tile: 1, FrameTile: 0 },
            { uid: 'door-b', type: 'door', x: '0', y: '0', dir: 'W', Tile: 1, FrameTile: 0 },
        ];
        building.floors.push({ rooms: writeIndexGrid(emptyIndexGrid(2, 2)), objects: [{ uid: 'door-c', type: 'door', x: 0, y: 0, dir: 'W', Tile: 1, FrameTile: 0 }] });
        const scene = documentHarness(building);
        scene.store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_exterior_house_01_010.png'));
        scene.store.dispatch(new RemoveObject('door-a'));
        expect(scene.grid.objects.map(object => object.uid)).toEqual(['door-b', 'door-c']);
        expect(scene.grid.roomTiles.some(tile => tile.object === 'door-a')).toBeFalse();
        expect(scene.grid.userTiles.some(tile => tile.layer === 'Walls' && tile.name === 'walls_exterior_house_01_010.png')).toBeTrue();
        scene.store.dispatch(new RemoveObject('door-b'));
        scene.store.dispatch(new RemoveTile(0, 0, 0, 'Walls'));
        expect(scene.grid.getTileAt(0, 0, 0, 'Walls')?.name).toBe('walls_interior_house_01_002.png');
        expect(scene.grid.roomTiles.some(tile => tile.layer === 'Doors' && tile.level === 0)).toBeFalse();
        const reopened = readBuildingFile(writeBuildingFile(scene.buildings.building));
        expect(reopened.floors[0].objects.length).toBe(0);
        expect(reopened.floors[1].objects.length).toBe(1);
        scene.destroy();
    });

    it('moves object projections by UID and reconstructs identical scene data on repeated rebuilds', () => {
        const scene = documentHarness(sceneBuilding());
        const add = new AddObject({ type: 'door', x: 0, y: 0, dir: 'W', Tile: 1, FrameTile: 0 }, 0);
        scene.store.dispatch(add);
        scene.store.dispatch(new UpdateObject(add.obj.uid, { x: 1 }));
        expect(scene.grid.objects.find(object => object.uid === add.obj.uid)?.x).toBe(1);
        expect(scene.grid.roomTiles.filter(tile => tile.layer === 'Doors').every(tile => tile.x === 1)).toBeTrue();
        expect(scene.grid.userTiles.length).toBe(0);
        const snapshot = JSON.stringify({ tiles: scene.grid.tiles, objects: scene.grid.objects });
        scene.buildings.renderBuilding(scene.buildings.building);
        expect(JSON.stringify({ tiles: scene.grid.tiles, objects: scene.grid.objects })).toBe(snapshot);
        scene.destroy();
    });

    it('commits room drags once and uses room indices even when names are duplicated', () => {
        const building = sceneBuilding();
        building.rooms.push({ ...building.rooms[0], InternalName: 'second-office' });
        const scene = documentHarness(building);
        scene.rooms.selectedRoom = scene.buildings.building.rooms[1];
        const tool = new ToolDrawRoom(scene.rooms, scene.grid, scene.buildings, scene.store as any);
        const before = scene.dispatched.length;
        tool.beginDrag(1, 1); tool.endDrag(0, 0);
        expect(scene.dispatched.slice(before).filter(action => action.type === ActionTypes.EditRooms).length).toBe(1);
        expect(readIndexGrid(scene.buildings.building.floors[0].rooms, 2, 2)).toEqual([[2, 2], [2, 2]]);
        expect(scene.rooms.rooms[0].tiles.length).toBe(0);
        expect(scene.rooms.rooms[1].tiles.length).toBe(4);
        tool.key = 'Control'; tool.beginDrag(0, 0); tool.endDrag(0, 0);
        expect(scene.rooms.getRoomFromTile(0, 0, 0)).toBeNull();
        scene.destroy();
    });

    it('commits tile drags and clicks to the document and erases only the selected floor', () => {
        const building = sceneBuilding();
        building.floors.push({ rooms: writeIndexGrid(emptyIndexGrid(2, 2)), objects: [] });
        const scene = documentHarness(building);
        scene.store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_exterior_house_01_010.png'));
        const tool = new ToolTile(scene.grid, scene.store as any);
        tool.selectedTile = 'walls_exterior_house_01_011.png'; tool.selectedLayer = 'Walls';
        scene.grid.setSelectedLevel(1);
        tool.beginDrag(0, 0); tool.endDrag(2, 2);
        tool.key = 'Control'; tool.beginDrag(0, 0); tool.endDrag(0, 0);
        expect(scene.grid.userTiles.some(tile => tile.x === 0 && tile.y === 0 && tile.level === 0)).toBeTrue();
        expect(scene.grid.userTiles.some(tile => tile.x === 0 && tile.y === 0 && tile.level === 1)).toBeFalse();
        expect(scene.grid.userTiles.filter(tile => tile.level === 1).length).toBe(8);
        tool.key = ''; tool.clickTile(0, 0);
        const reopened = readBuildingFile(writeBuildingFile(scene.buildings.building));
        expect(readIndexGrid(reopened.floors[1].tileLayers![0].tiles, 3, 3)[0][0]).toBeGreaterThan(0);
        scene.store.dispatch(new SetBuilding(reopened));
        expect(scene.grid.userTiles.filter(tile => tile.level === 1).length).toBe(9);
        scene.destroy();
    });

    it('places doors and windows into the selected document floor', () => {
        const building = sceneBuilding();
        building.floors.push({ rooms: writeIndexGrid(emptyIndexGrid(2, 2)), objects: [] });
        const scene = documentHarness(building);
        scene.grid.setSelectedLevel(1);
        const doors = new ToolDoor(new DoorService(scene.grid, scene.buildings, scene.store as any), scene.grid);
        const windows = new ToolWindow(new WindowService(scene.grid, scene.buildings, scene.store as any), scene.grid, scene.buildings);
        doors.edge = 'N'; doors.beginDrag(0, 0); doors.endDrag(0, 0);
        windows.edge = 'W'; windows.beginDrag(1, 0); windows.endDrag(1, 0);
        expect(scene.buildings.building.floors[0].objects.length).toBe(0);
        expect(scene.buildings.building.floors[1].objects.map(object => object.type)).toEqual(['door', 'window']);
        expect(scene.grid.objects.every(object => object.level === 1)).toBeTrue();
        scene.destroy();
    });

    it('caches the latest edited document without triggering file downloads', fakeAsync(() => {
        const scene = documentHarness(sceneBuilding());
        const cache = spyOn(Storage.prototype, 'setItem');
        const effect = scene.effects.cacheDocument$.subscribe();
        scene.store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_exterior_house_01_010.png'));
        scene.store.dispatch(new EditRooms({ x: 0, y: 0, width: 1, height: 1 }, 0, 0));
        tick(201);
        expect(cache).toHaveBeenCalledTimes(1);
        const restored = readBuildingFile(new DOMParser().parseFromString(cache.calls.mostRecent().args[1], 'text/xml'));
        expect(readIndexGrid(restored.floors[0].rooms, 2, 2)[0][0]).toBe(0);
        expect(restored.floors[0].tileLayers![0].layer).toBe('Walls');
        effect.unsubscribe(); scene.destroy();
    }));

    it('rebuilds roof caps from UID updates instead of excluding transient tiles', () => {
        const building = sceneBuilding();
        building.entries.push(
            { category: 'roof_caps', tiles: [{ enum: 'PeakPt5S', tile: 'roofs_01_000' }] },
            { category: 'roof_slopes', tiles: [{ enum: 'SlopePt5E', tile: 'roofs_01_001' }] },
            { category: 'roof_tops', tiles: [] },
        );
        building.RoofCap = 5; building.RoofSlope = 6; building.RoofTop = 7;
        building.floors[0].objects.push({ uid: 'roof', type: 'roof', x: 0, y: 0, width: 1, height: 1,
            RoofType: 'PeakNS', Depth: 'Point5', CapTiles: 5, SlopeTiles: 6, TopTiles: 7,
            cappedN: 'true', cappedS: 'true', cappedW: 'true', cappedE: 'true' });
        const scene = documentHarness(building);
        expect(scene.grid.roomTiles.some(tile => tile.tag === 'cappedN')).toBeTrue();
        scene.store.dispatch(new UpdateObject('roof', { cappedN: 'false' }));
        expect(scene.grid.roomTiles.some(tile => tile.tag === 'cappedN')).toBeFalse();
        expect(scene.grid.roomTiles.some(tile => tile.tag === 'cappedS')).toBeTrue();
        const loaded = readBuildingFile(writeBuildingFile(scene.buildings.building));
        scene.store.dispatch(new SetBuilding(loaded));
        expect(scene.grid.roomTiles.some(tile => tile.tag === 'cappedN')).toBeFalse();
        scene.destroy();
    });

    it('runs through registered NgRx effects with immutable state checks enabled', fakeAsync(() => {
        TestBed.configureTestingModule({
            imports: [StoreModule.forRoot({ root: (state: State | undefined, action: Action) => reducer(state, action as ActionsUnion) }), EffectsModule.forRoot([RootEffects])],
            providers: [{ provide: HttpClient, useValue: {} }, { provide: DbService, useValue: {} },
                { provide: CacheService, useValue: {} }, { provide: TileService, useValue: {} }],
        });
        const store = TestBed.inject(Store);
        const grid = TestBed.inject(GridService);
        const service = TestBed.inject(BuildingService);
        spyOn(grid, 'getIndividualTile').and.callFake(name => name);
        spyOn(Storage.prototype, 'setItem');
        store.dispatch(new SetBuilding(sceneBuilding()));
        const add = new AddObject({ type: 'door', x: 0, y: 0, dir: 'W', Tile: 1, FrameTile: 0 }, 0);
        store.dispatch(add);
        expect(grid.objects.some(object => object.uid === add.obj.uid)).toBeTrue();
        expect(Object.isFrozen(service.building)).toBeTrue();
        store.dispatch(new RemoveObject(add.obj.uid));
        expect(service.building.floors[0].objects.length).toBe(0);
        expect(grid.objects.length).toBe(0);
        store.dispatch(new Undo());
        expect(grid.objects[0].uid).toBe(add.obj.uid);
        store.dispatch(new Redo());
        expect(grid.objects.length).toBe(0);
        tick(201);
    }));

    it('rebuilds for document changes, keeps the view on edits and resets it on document replacement', () => {
        const building = sceneBuilding();
        building.floors.push({ rooms: writeIndexGrid(emptyIndexGrid(2, 2)), objects: [] });
        const scene = documentHarness(building);
        const render = spyOn(scene.buildings, 'renderBuilding').and.callThrough();
        scene.grid.setSelectedLevel(1);
        scene.store.dispatch(new SetCurrentTool('tool-tile'));
        scene.store.dispatch(new RemoveObject('missing'));
        expect(render).not.toHaveBeenCalled();
        scene.store.dispatch(new AddTile(0, 0, 1, 'Walls', 'walls_exterior_house_01_010.png'));
        expect(render).toHaveBeenCalledTimes(1);
        expect(scene.grid.getSelectedLevel()).toBe(1);
        scene.store.dispatch(new SetBuilding(scene.buildings.building));
        expect(render).toHaveBeenCalledTimes(2);
        expect(scene.grid.getSelectedLevel()).toBe(0);
        scene.destroy();
    });
});
