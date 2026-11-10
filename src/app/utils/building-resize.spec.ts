import { CropBuildingToMinimum, Redo, ResizeBuilding, SetBuilding, SetDocumentLocked, Undo } from '../app.actions';
import { initialState, reducer } from '../app.reducers';
import { Building } from '../models/app.models';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { cropBuildingToMinimum, minimumBuildingBounds, resizeBuilding } from './building-resize';
import { readBuildingFile, writeBuildingFile } from './tbx-format';
import { emptyIndexGrid, readIndexGrid, writeIndexGrid } from './tbx-grid';

function scene(): Building {
    const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    return { ...building, width: 12, height: 10, floors: [0, 1].map(() => ({ objects: [],
        rooms: writeIndexGrid(emptyIndexGrid(12, 10)), tileLayers: [] })) };
}

function room(building: Building, level: number, x: number, y: number): void {
    const grid = readIndexGrid(building.floors[level].rooms, building.width, building.height);
    grid[y][x] = 1; building.floors[level].rooms = writeIndexGrid(grid);
}

function tile(building: Building, level: number, x: number, y: number): void {
    const grid = emptyIndexGrid(building.width + 1, building.height + 1); grid[y][x] = 1;
    building.floors[level].tileLayers = [{ layer: 'Walls', tiles: writeIndexGrid(grid) }];
}

describe('Native building area resize and crop', () => {
    it('grows all floors with an offset, retaining boundary tiles, UIDs and document tables', () => {
        const before = scene(); room(before, 0, 2, 3); room(before, 1, 5, 6); tile(before, 1, 12, 10);
        before.floors[1].objects = [{ type: 'door', uid: 'door', x: '12', y: '10', dir: 'N' }];
        const snapshot = JSON.stringify(before);
        const after = resizeBuilding(before, { width: 16, height: 13, offsetX: 3, offsetY: 2 });
        expect(readIndexGrid(after.floors[0].rooms, 16, 13)[5][5]).toBe(1);
        expect(readIndexGrid(after.floors[1].rooms, 16, 13)[8][8]).toBe(1);
        expect(readIndexGrid(after.floors[1].tileLayers![0].tiles, 17, 14)[12][15]).toBe(1);
        expect(after.floors[1].objects).toEqual([{ type: 'door', uid: 'door', x: 15, y: 12, dir: 'N' }]);
        expect(after.entries).toBe(before.entries); expect(after.furniture).toBe(before.furniture);
        expect(after.properties).toBe(before.properties); expect(JSON.stringify(before)).toBe(snapshot);
    });

    it('crops grids and removes whole objects that do not fit, respecting native boundary rules', () => {
        const before = scene(); room(before, 0, 2, 3); room(before, 0, 0, 0); tile(before, 0, 6, 7);
        before.floors[0].objects = [
            { type: 'door', uid: 'door', x: 6, y: 5, dir: 'W' },
            { type: 'window', uid: 'window', x: 4, y: 7, dir: 'N' },
            { type: 'wall', uid: 'vertical', x: 6, y: 3, dir: 'N', length: 4 },
            { type: 'wall', uid: 'horizontal', x: 2, y: 7, dir: 'W', length: 4 },
            { type: 'wall', uid: 'long-wall', x: 2, y: 3, dir: 'W', length: 5 },
            { type: 'furniture', uid: 'outside-furniture', x: 6, y: 5, FurnitureTiles: 0, orient: 'W' },
            { type: 'roof', uid: 'outside-roof', x: 2, y: 3, width: 5, height: 4 },
            { type: 'stairs', uid: 'outside-stairs', x: 2, y: 3, dir: 'N' },
        ];
        const after = resizeBuilding(before, { width: 4, height: 4, offsetX: -2, offsetY: -3 });
        expect(readIndexGrid(after.floors[0].rooms, 4, 4)[0][0]).toBe(1);
        expect(readIndexGrid(after.floors[0].rooms, 4, 4).flat().filter(Boolean).length).toBe(1);
        expect(readIndexGrid(after.floors[0].tileLayers![0].tiles, 5, 5)[4][4]).toBe(1);
        expect(after.floors[0].objects.map(object => object.uid)).toEqual(['door', 'window', 'vertical', 'horizontal']);
    });

    it('finds the occupied room bounds across all floors and rebases content to zero', () => {
        const before = scene(); room(before, 0, 3, 4); room(before, 1, 7, 6);
        expect(minimumBuildingBounds(before)).toEqual({ x: 3, y: 4, width: 5, height: 3 });
        const after = cropBuildingToMinimum(before);
        expect([after.width, after.height]).toEqual([5, 3]);
        expect(readIndexGrid(after.floors[0].rooms, 5, 3)[0][0]).toBe(1);
        expect(readIndexGrid(after.floors[1].rooms, 5, 3)[2][4]).toBe(1);
        expect(cropBuildingToMinimum(after)).toBe(after);
    });

    it('keeps outer walls, doors, windows and manual tiles without adding a row or column', () => {
        const before = scene(); room(before, 0, 3, 4); room(before, 0, 6, 6); tile(before, 1, 7, 7);
        const tiles = readIndexGrid(before.floors[1].tileLayers![0].tiles, 13, 11); tiles[4][3] = 1;
        before.floors[1].tileLayers![0].tiles = writeIndexGrid(tiles);
        before.floors[0].objects = [
            { type: 'door', x: 5, y: 7, dir: 'N' }, { type: 'window', x: 7, y: 5, dir: 'W' },
            { type: 'wall', x: 7, y: 4, dir: 'N', length: 3 }, { type: 'wall', x: 3, y: 7, dir: 'W', length: 4 },
        ];
        expect(minimumBuildingBounds(before)).toEqual({ x: 3, y: 4, width: 4, height: 3 });
        const after = cropBuildingToMinimum(before);
        expect(after.floors[0].objects.length).toBe(4);
        expect(readIndexGrid(after.floors[1].tileLayers![0].tiles, 5, 4)[3][4]).toBe(1);
    });

    it('uses the full footprint of furniture, roofs and stairs, even without rooms', () => {
        const before = scene();
        before.furniture = [{ entries: [{ orient: 'W', tiles: [{ x: 2, y: 1, name: 'seat' }] }] }];
        before.floors[0].objects = [{ type: 'furniture', x: 3, y: 4, FurnitureTiles: 0, orient: 'W' }];
        before.floors[1].objects = [{ type: 'stairs', x: 5, y: 3, dir: 'N' }, { type: 'roof', x: 4, y: 2, width: 4, height: 3 }];
        expect(minimumBuildingBounds(before)).toEqual({ x: 3, y: 2, width: 5, height: 6 });
        expect(cropBuildingToMinimum(before).floors.map(floor => floor.objects.length)).toEqual([1, 2]);
    });

    it('finds manual tiles on any layer and preserves their native extra border', () => {
        const before = scene(); tile(before, 0, 3, 4); tile(before, 1, 8, 7);
        expect(minimumBuildingBounds(before)).toEqual({ x: 3, y: 4, width: 5, height: 3 });
        const after = cropBuildingToMinimum(before);
        expect(readIndexGrid(after.floors[0].tileLayers![0].tiles, 6, 4)[0][0]).toBe(1);
        expect(readIndexGrid(after.floors[1].tileLayers![0].tiles, 6, 4)[3][5]).toBe(1);
    });

    it('ignores empty crops, unchanged sizes and invalid dimensions or offsets', () => {
        const before = scene(); expect(minimumBuildingBounds(before)).toBeUndefined();
        expect(cropBuildingToMinimum(before)).toBe(before);
        for (const edit of [
            { width: 12, height: 10, offsetX: 0, offsetY: 0 }, { width: 0, height: 5, offsetX: 0, offsetY: 0 },
            { width: 257, height: 5, offsetX: 0, offsetY: 0 }, { width: 2.5, height: 5, offsetX: 0, offsetY: 0 },
            { width: 12, height: 10, offsetX: NaN, offsetY: 0 }, { width: 14, height: 10, offsetX: 3, offsetY: 0 },
        ]) expect(resizeBuilding(before, edit)).toBe(before);
        expect(resizeBuilding(before, { width: 1, height: 1, offsetX: 0, offsetY: 0 }).width).toBe(1);
        expect(resizeBuilding(before, { width: 256, height: 256, offsetX: 0, offsetY: 0 }).height).toBe(256);
    });

    it('undoes and redoes each operation as one edit, restores cropped content, and round trips TBX', () => {
        const building = scene(); room(building, 1, 4, 5); tile(building, 0, 7, 8);
        const before = reducer(initialState, new SetBuilding(building));
        for (const action of [new ResizeBuilding({ width: 3, height: 4, offsetX: -4, offsetY: -4 }, 1), new CropBuildingToMinimum(1)]) {
            const after = reducer(before, action);
            expect(after.past.length).toBe(1); expect(after.past[0].level).toBe(1);
            expect(reducer(after, new Undo()).building).toBe(before.building);
            expect(reducer(reducer(after, new Undo()), new Redo()).building).toBe(after.building);
            const restored = readBuildingFile(writeBuildingFile(after.building!));
            expect([restored.width, restored.height]).toEqual([after.building!.width, after.building!.height]);
            expect(restored.floors).toEqual(after.building!.floors);
            const locked = reducer(before, new SetDocumentLocked(true)); expect(reducer(locked, action)).toBe(locked);
        }
    });
});
