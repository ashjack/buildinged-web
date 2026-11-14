import { Redo, SetBuilding, SetDocumentLocked, TransformBuilding, Undo } from '../app.actions';
import { initialState, reducer } from '../app.reducers';
import { Building } from '../models/app.models';
import { ROOF_OPTIONS } from '../services/roof-patterns';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { BuildingTransform, transformBuilding } from './building-transform';
import { readBuildingFile, writeBuildingFile } from './tbx-format';
import { emptyIndexGrid, readIndexGrid, writeIndexGrid } from './tbx-grid';

function scene(): Building {
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    return { ...b, width: 12, height: 10, floors: [0, 1].map(() => ({ objects: [],
        rooms: writeIndexGrid(emptyIndexGrid(12, 10)), tileLayers: [] })) };
}
function objects(b: Building, operation: BuildingTransform): any[] { return transformBuilding(b, operation).floors[0].objects; }

describe('Native whole-building transformations', () => {
    it('transforms all room grids and painted cells, preserving artwork, tables, layers and metadata', () => {
        const before = scene();
        const rooms = emptyIndexGrid(12, 10); rooms[3][2] = 1;
        const tiles = emptyIndexGrid(13, 11); tiles[6][4] = 1;
        before.floors.forEach(f => { f.rooms = writeIndexGrid(rooms); f.tileLayers = [{ layer: 'Walls', tiles: writeIndexGrid(tiles) }]; });
        const snapshot = JSON.stringify(before);
        const after = transformBuilding(before, 'rotate-right');
        expect([after.width, after.height]).toEqual([10, 12]);
        for (const floor of after.floors) {
            expect(readIndexGrid(floor.rooms, 10, 12)[2][6]).toBe(1);
            expect(readIndexGrid(floor.tileLayers![0].tiles, 11, 13)[4][3]).toBe(1);
        }
        expect(after.entries).toBe(before.entries); expect(after.user_tiles).toBe(before.user_tiles);
        expect(after.properties).toBe(before.properties); expect(JSON.stringify(before)).toBe(snapshot);
        const loaded = readBuildingFile(writeBuildingFile(after));
        expect(loaded.floors).toEqual(after.floors);
    });

    it('applies edge offsets to openings, length-aware wall coordinates, and five-square stairs', () => {
        const b = scene(); b.floors[0].objects = [
            { type: 'door', x: 2, y: 0, dir: 'N', uid: 'door', Tile: 1 },
            { type: 'window', x: 12, y: 3, dir: 'W', uid: 'window' },
            { type: 'wall', x: 12, y: 2, dir: 'N', length: 4, uid: 'wall' },
            { type: 'wall', x: 2, y: 10, dir: 'W', length: 4 },
            { type: 'stairs', x: 2, y: 3, dir: 'N' },
            { type: 'stairs', x: 3, y: 2, dir: 'W' },
        ];
        expect(objects(b, 'rotate-right').map(o => [o.x, o.y, o.dir])).toEqual([
            [10, 2, 'W'], [6, 12, 'N'], [4, 12, 'W'], [0, 2, 'N'], [2, 2, 'W'], [7, 3, 'N'],
        ]);
        expect(objects(b, 'rotate-left').map(o => [o.x, o.y, o.dir])).toEqual([
            [0, 9, 'W'], [3, 0, 'N'], [2, 0, 'W'], [10, 6, 'N'], [3, 9, 'W'], [2, 4, 'N'],
        ]);
        expect(objects(b, 'flip-horizontal').map(o => [o.x, o.y, o.dir])).toEqual([
            [9, 0, 'N'], [0, 3, 'W'], [0, 2, 'N'], [6, 10, 'W'], [9, 3, 'N'], [4, 2, 'W'],
        ]);
        expect(objects(b, 'flip-vertical').map(o => [o.x, o.y, o.dir])).toEqual([
            [2, 10, 'N'], [12, 6, 'W'], [12, 4, 'N'], [2, 0, 'W'], [2, 2, 'N'], [3, 7, 'W'],
        ]);
        expect(objects(b, 'rotate-right')[0]).toEqual(jasmine.objectContaining({ uid: 'door', Tile: 1 }));
    });

    it('resolves the new furniture orientation before positioning asymmetrical and fallback sprites', () => {
        const b = scene(); b.furniture = [{ entries: [
            { orient: 'W', tiles: [{ x: 0, y: 0, name: 'w' }, { x: 2, y: 0, name: 'w' }] },
            { orient: 'N', tiles: [{ x: 0, y: 0, name: 'n' }, { x: 0, y: 1, name: 'n' }] },
        ] }];
        b.floors[0].objects = [{ type: 'furniture', x: 2, y: 3, FurnitureTiles: 0, orient: 'W' }];
        expect(objects(b, 'rotate-right')[0]).toEqual(jasmine.objectContaining({ x: 6, y: 2, orient: 'N' }));
        expect(objects(b, 'rotate-left')[0]).toEqual(jasmine.objectContaining({ x: 3, y: 7, orient: 'S' }));
        expect(objects(b, 'flip-horizontal')[0]).toEqual(jasmine.objectContaining({ x: 7, y: 3, orient: 'E' }));
        b.floors[0].objects[0].orient = 'N';
        expect(objects(b, 'flip-vertical')[0]).toEqual(jasmine.objectContaining({ x: 2, y: 5, orient: 'S' }));
    });

    it('maps all eight furniture orientations, including empty corners without inventing tiles', () => {
        const b = scene(), orientations = ['W', 'N', 'E', 'S', 'SW', 'NW', 'NE', 'SE'];
        b.floors[0].objects = orientations.map(orient => ({ type: 'furniture', x: 2, y: 3, FurnitureTiles: 0, orient }));
        expect(objects(b, 'rotate-right').map(o => o.orient)).toEqual(['N', 'E', 'S', 'W', 'NW', 'NE', 'SE', 'SW']);
        expect(objects(b, 'flip-horizontal').map(o => o.orient)).toEqual(['E', 'N', 'W', 'S', 'SE', 'NE', 'NW', 'SW']);
        expect(objects(b, 'flip-vertical').map(o => o.orient)).toEqual(['W', 'S', 'E', 'N', 'NW', 'SW', 'SE', 'NE']);
    });

    it('rotates roof footprints, slopes, peaks, dormers, corners and individual cap flags', () => {
        const b = scene(); b.floors[0].objects = ['SlopeW', 'PeakWE', 'DormerN', 'CornerInnerSW', 'ShallowSlopeE', 'Slope30S', 'CornerSlope30OuterNE'].map(RoofType => ({
            type: 'roof', x: 2, y: 3, width: 4, height: 2, RoofType, Depth: 'Two',
            cappedW: 'false', cappedN: 'true', cappedE: false, cappedS: true,
        }));
        const right = objects(b, 'rotate-right');
        expect(right.map(o => o.RoofType)).toEqual(['SlopeN', 'PeakNS', 'DormerE', 'CornerInnerNW', 'ShallowSlopeS', 'Slope30W', 'CornerSlope30OuterSE']);
        expect(right[0]).toEqual(jasmine.objectContaining({ x: 5, y: 2, width: 2, height: 4, Depth: 'Two',
            cappedW: true, cappedN: 'false', cappedE: 'true', cappedS: false }));
        expect(objects(b, 'flip-horizontal').map(o => o.RoofType)).toEqual(['SlopeE', 'PeakWE', 'DormerN', 'CornerInnerSE', 'ShallowSlopeW', 'Slope30S', 'CornerSlope30OuterNE']);
        expect(objects(b, 'flip-vertical').map(o => o.RoofType)).toEqual(['SlopeW', 'PeakWE', 'DormerS', 'CornerInnerNW', 'ShallowSlopeE', 'Slope30N', 'CornerSlope30OuterNE']);
    });

    it('restores every supported roof after four turns or two flips', () => {
        const b = scene(); b.floors[0].objects = ROOF_OPTIONS.map(option => ({ type: 'roof', x: 2, y: 3, width: 4, height: 2, RoofType: option.roofType }));
        for (const operation of ['rotate-left', 'rotate-right', 'flip-horizontal', 'flip-vertical'] as BuildingTransform[]) {
            let after = b;
            for (let i = 0; i < (operation.startsWith('rotate') ? 4 : 2); i++) after = transformBuilding(after, operation);
            expect(after).withContext(operation).toEqual(b);
        }
    });

    it('rejects border tiles atomically and does not add rejected edits to history', () => {
        const b = scene(), tiles = emptyIndexGrid(13, 11); tiles[10][12] = 1;
        b.floors[1].tileLayers = [{ layer: 'Roof', tiles: writeIndexGrid(tiles) }];
        const before = reducer(initialState, new SetBuilding(b)), snapshot = JSON.stringify(before);
        expect(() => transformBuilding(b, 'rotate-right')).toThrowError(/level 1, layer Roof at 12,10/);
        expect(reducer(before, new TransformBuilding('rotate-right', 1))).toBe(before);
        expect(JSON.stringify(before)).toBe(snapshot);
    });

    it('commits every floor as a single undoable edit and respects document locking', () => {
        const before = reducer(initialState, new SetBuilding(scene()));
        const after = reducer(before, new TransformBuilding('rotate-right', 1));
        expect(after.past.length).toBe(1); expect(after.past[0].label).toBe('Rotate right');
        const undone = reducer(after, new Undo()); expect(undone.building).toBe(before.building); expect(undone.historyFloor).toBe(1);
        expect(reducer(undone, new Redo()).building).toBe(after.building);
        const locked = reducer(before, new SetDocumentLocked(true));
        expect(reducer(locked, new TransformBuilding('flip-horizontal', 0))).toBe(locked);
    });
});
