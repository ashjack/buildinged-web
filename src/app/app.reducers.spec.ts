import { AddObject, AddRoom, AddTile, EditTiles, RemoveObject, RemoveTile, SetBuilding, SetSelectedFurniture, UpdateObject } from './app.actions';
import { initialState, reducer } from './app.reducers';
import { Furniture } from './models/app.models';
import { readBuildingFile, writeBuildingFile } from './utils/tbx-format';
import { readIndexGrid } from './utils/tbx-grid';
import { nativeBuildingXml } from './testing/native-building.fixture';

const state = () => ({ ...initialState, building: readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')) });

describe('Edits preserve TBX indices and grids', () => {
    it('edits a compact room grid and writes native CSV without shifting other cells', () => {
        const before = state();
        before.building.floors[0].rooms = '1,0,0,1';
        const after = reducer(before, new AddRoom(1, 0, 0, 1));
        expect(after.building!.floors[0].rooms).toBe('\n1,1,\n0,1\n');
        expect(before.building.floors[0].rooms).toBe('1,0,0,1');
        expect(reducer(before, new AddRoom(2, 0, 0, 1))).toBe(before);
    });

    it('keeps one-based user tile references and permits the tile border', () => {
        let current = state();
        const first = reducer(current, new AddTile(2, 2, 0, 'Floor', current.building.user_tiles[0].tile + '.png'));
        expect(first.building!.user_tiles.length).toBe(1);
        const second = reducer(first, new AddTile(2, 0, 0, 'Walls', 'walls_exterior_house_01_000.png'));
        const grid = readIndexGrid(second.building!.floors[0].tileLayers!.find(layer => layer.layer === 'Walls')!.tiles, 3, 3);
        expect(grid[0][2]).toBe(2);
        expect(second.building!.floors[0].tileLayers!.find(layer => layer.layer === 'Walls')!.tiles.trim().split(',').length).toBe(9);
        expect(() => writeBuildingFile(second.building!)).not.toThrow();
        expect(reducer(current, new AddTile(3, 0, 0, 'Walls', 'unused.png'))).toBe(current);
    });

    it('selects furniture without modifying the building tables', () => {
        const before = state();
        const after = reducer(before, new SetSelectedFurniture({ entries: [] }, 'W'));
        expect(after.building).toBe(before.building);
    });

    it('registers and reuses furniture definitions without changing existing indices', () => {
        const before = state();
        const definition: Furniture = { entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'furniture_seating_indoor_01_003' }] }] };
        const object = { type: 'furniture', x: 1, y: 1, orient: 'W', FurnitureTiles: 0 };
        const after = reducer(before, new AddObject(object, 0, definition));
        expect(after.building!.furniture.length).toBe(3);
        expect(after.building!.floors[0].objects[2].FurnitureTiles).toBe(2);
        expect(after.building!.floors[0].objects[0].FurnitureTiles).toBe('1');
        const again = reducer(after, new AddObject(object, 0, definition));
        expect(again.building!.furniture.length).toBe(3);
        expect(again.building!.floors[0].objects[3].FurnitureTiles).toBe(2);
        expect(() => writeBuildingFile(again.building!)).not.toThrow();
        expect(before.building.furniture.length).toBe(2);
    });

    it('assigns unique UIDs when opening objects with absent or duplicate identities', () => {
        const source = state().building;
        source.floors[0].objects = [{ type: 'door', uid: 'same' }, { type: 'door', uid: 'same' }, { type: 'door' }];
        const action = new SetBuilding(source);
        const ids = action.building.floors[0].objects.map(object => object.uid);
        expect(new Set(ids).size).toBe(3);
        expect(ids[0]).toBe('same');
        expect(ids.every(uid => typeof uid === 'string' && uid.length > 0)).toBeTrue();
        expect(source.floors[0].objects[2].uid).toBeUndefined();
        expect(reducer({ ...initialState, building: action.building }, new AddObject({ uid: 'same', type: 'door' }, 0)).building).toBe(action.building);
    });

    it('updates and removes exactly one UID across floors regardless of coordinates or display types', () => {
        const before = state();
        before.building.floors = [
            { rooms: '\n0,0,\n0,0\n', objects: [{ uid: 'a', type: 'door', x: '1', y: '1', dir: 'W' }, { uid: 'b', type: 'door', x: '1', y: '1', dir: 'W' }] },
            { rooms: '\n0,0,\n0,0\n', objects: [{ uid: 'c', type: 'door', x: 1, y: 1, dir: 'W' }] },
        ];
        const updated = reducer(before, new UpdateObject('b', { x: 0, uid: 'replacement' }));
        expect(updated.building!.floors[0].objects[1]).toEqual({ uid: 'b', type: 'door', x: 0, y: '1', dir: 'W' });
        expect(updated.building!.floors[1]).toBe(before.building.floors[1]);
        const removed = reducer(updated, new RemoveObject('a'));
        expect(removed.building!.floors[0].objects.map(object => object.uid)).toEqual(['b']);
        expect(removed.building!.floors[1].objects[0].uid).toBe('c');
        expect(reducer(removed, new RemoveObject('missing'))).toBe(removed);
        expect(reducer(removed, new UpdateObject('missing', { x: 1 }))).toBe(removed);
        expect(reducer(removed, new UpdateObject('b', { x: 0 }))).toBe(removed);
    });

    it('erases manual tiles on only the specified floor and layer without renumbering the table', () => {
        const before = state();
        before.building.floors.push({ ...before.building.floors[0] });
        const painted = reducer(before, new EditTiles({ x: 0, y: 0, width: 3, height: 3 }, 1, 'Walls', 'walls_exterior_house_01_000.png'));
        const erased = reducer(painted, new RemoveTile(0, 0, 1, 'Walls'));
        expect(erased.building!.floors[0]).toBe(before.building.floors[0]);
        expect(readIndexGrid(erased.building!.floors[1].tileLayers!.find(layer => layer.layer === 'Walls')!.tiles, 3, 3)[0][0]).toBe(0);
        expect(erased.building!.floors[1].tileLayers!.find(layer => layer.layer === 'Floor')).toBe(painted.building!.floors[1].tileLayers!.find(layer => layer.layer === 'Floor'));
        expect(erased.building!.user_tiles).toBe(painted.building!.user_tiles);
        expect(readIndexGrid(erased.building!.floors[1].tileLayers!.find(layer => layer.layer === 'Walls')!.tiles, 3, 3)[0][1]).toBe(2);
    });
});
