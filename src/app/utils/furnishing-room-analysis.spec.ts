import { Building, Furniture, Point } from '../models/app.models';
import { FurnishingCatalog } from '../models/auto-furnishing.models';
import { readBuildingFile, writeBuildingFile } from './tbx-format';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { emptyIndexGrid, writeIndexGrid } from './tbx-grid';
import { analyzeFurnishingRooms, furnishingCellKey, suggestFurnishingRoomType } from './furnishing-room-analysis';
import { generateBuildingSquares } from '../services/native-squares';
import { buildFurnishingCatalog } from './furnishing-catalog';

function fixture(grid = [[1, 1, 1], [1, 1, 1]]): Building {
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    b.width = grid[0].length; b.height = grid.length;
    b.entries = [
        { category: 'interior_walls', tiles: ['West', 'North', 'NorthWest', 'SouthEast', 'WestDoor', 'NorthDoor', 'WestWindow', 'NorthWindow'].map(value => ({ enum: value, tile: `wall-${value}` })) },
        { category: 'floors', tiles: [{ enum: 'Floor', tile: 'floor_000' }] }
    ];
    b.ExteriorWall = 1; b.ExteriorWallTrim = b.GrimeWall = 0;
    b.Door = b.DoorFrame = b.Window = b.Curtains = b.Shutters = b.Stairs = b.RoofCap = b.RoofSlope = b.RoofTop = 0;
    b.rooms = ['Bedroom1', 'Bathroom', 'EmptyOutside'].map((Name, index) => ({ Name, InternalName: index === 0 ? 'bedroom' : index === 1 ? 'bathroom' : 'emptyoutside', Color: '200 200 200',
        InteriorWall: 1, InteriorWallTrim: 0, Floor: 2, GrimeFloor: 0, GrimeWall: 0 }));
    b.furniture = []; b.user_tiles = []; b.used_tiles = b.used_furniture = '';
    b.floors = [{ rooms: writeIndexGrid(grid), objects: [], tileLayers: [] }]; return b;
}
const keys = (cells: Point[]) => cells.map(furnishingCellKey);
function freeze(value: any): void {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}
describe('Physical room preparation for auto furnishing', () => {
    it('separates disconnected regions and floors, retaining exact L-shaped cells and stable derived identities', () => {
        const b = fixture([[1, 1, 0], [1, 0, 1], [0, 0, 1]]);
        b.floors.push({ ...b.floors[0], objects: [] });
        const result = analyzeFurnishingRooms(b);
        expect(result.rooms.length).toBe(4); expect(new Set(result.rooms.map(room => room.id)).size).toBe(4);
        expect(result.rooms[0].cells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
        expect(result.rooms[0].bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
        expect(result.rooms[0].suggestedType).toBe('bedroom');
        expect(analyzeFurnishingRooms(b)).toEqual(result);
    });
    it('splits the same room label at a native wall and links both sides of a None-tile doorway', () => {
        const b = fixture();
        b.floors[0].objects = [
            { uid: 'partition', type: 'wall', x: 1, y: 0, dir: 'N', length: 2, Tile: 1, InteriorTile: 1 },
            { uid: 'door', type: 'door', x: 1, y: 0, dir: 'W', Tile: 0, FrameTile: 0 }
        ];
        const result = analyzeFurnishingRooms(b);
        expect(result.rooms.map(room => room.cells.length)).toEqual([2, 4]);
        for (const room of result.rooms) {
            expect(room.entrances.length).toBe(1);
            expect(room.entrances[0].edge.opening?.uid).toBe('door');
            expect(room.entrances[0].targetRoomId).toBe(result.rooms.find(other => other !== room)!.id);
            expect(room.entrances[0].exterior).toBeFalse();
            expect(keys(room.reservedCells)).toContain(furnishingCellKey(room.entrances[0].inside));
        }
    });
    it('recognises external north/west doorways and windows, including the east building border', () => {
        const b = fixture(); b.floors[0].objects = [
            { uid: 'north', type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 },
            { uid: 'east', type: 'door', x: b.width, y: 1, dir: 'W', Tile: 0 },
            { uid: 'window', type: 'window', x: 1, y: 0, dir: 'N', Tile: 0 }
        ];
        const room = analyzeFurnishingRooms(b).rooms[0];
        expect(room.entrances.map(entrance => entrance.edge.opening?.uid).sort()).toEqual(['east', 'north']);
        expect(room.entrances.every(entrance => entrance.exterior && !entrance.targetRoomId)).toBeTrue();
        expect(room.windowEdges.map(edge => edge.opening?.uid)).toEqual(['window']);
    });
    it('follows last-opening-wins on each edge and keeps windows closed to movement', () => {
        const b = fixture([[1, 1], [1, 1]]);
        b.floors[0].objects = [
            { uid: 'partition', type: 'wall', x: 1, y: 0, dir: 'N', length: 2, Tile: 1, InteriorTile: 1 },
            { uid: 'old-door', type: 'door', x: 1, y: 0, dir: 'W', Tile: 0 },
            { uid: 'window', type: 'window', x: 1, y: 0, dir: 'W', Tile: 0 }
        ];
        const result = analyzeFurnishingRooms(b);
        expect(result.rooms.length).toBe(2);
        expect(result.rooms.every(room => !room.entrances.length && room.windowEdges[0].opening?.uid === 'window')).toBeTrue();
    });
    it('records open connections between different room types without inventing walls for None materials', () => {
        const b = fixture([[1, 2]]); b.rooms.forEach(room => room.InteriorWall = 0);
        const result = analyzeFurnishingRooms(b), left = result.rooms[0];
        const entrance = left.entrances.find(entrance => entrance.targetRoomId === result.rooms[1].id)!;
        expect(entrance.kind).toBe('open'); expect(entrance.edge.wall).toBeFalse();
        expect(result.rooms[1].suggestedType).toBe('bathroom');
    });
    it('excludes EmptyOutside and avoids guessing unknown custom room types', () => {
        const b = fixture([[1, 0, 3]]); b.rooms[0].Name = 'Custom Space'; b.rooms[0].InternalName = 'custom';
        const result = analyzeFurnishingRooms(b);
        expect(result.rooms.length).toBe(1); expect(result.rooms[0].suggestedType).toBe('unknown');
        expect(result.diagnostics.some(diagnostic => diagnostic.code === 'unknown-room-type')).toBeTrue();
        expect(suggestFurnishingRoomType({ ...b.rooms[0], Name: 'Bedroom 3' })).toBe('bedroom');
        expect(suggestFurnishingRoomType({ ...b.rooms[0], InternalName: 'foyer' })).toBe('hall');
    });
    it('reserves stairs and both levels of approaches while finding native floor holes and manual repairs', () => {
        const b = fixture(Array.from({ length: 6 }, () => Array(8).fill(1)));
        b.floors.push({ ...b.floors[0], objects: [] });
        b.floors[0].objects = [{ uid: 'stairs', type: 'stairs', x: 1, y: 2, dir: 'W', Tile: 0 }];
        let result = analyzeFurnishingRooms(b), above = result.rooms.find(room => room.level === 1)!;
        expect(keys(above.obstacles.find(obstacle => obstacle.kind === 'missing-floor')!.cells)).toEqual(['2:2', '3:2', '4:2']);
        expect(keys(above.reservedCells)).toContain('5:2');
        expect(keys(result.rooms[0].blockedCells)).not.toContain('2:2');
        b.user_tiles = [{ tile: 'manual-floor_000' }];
        const manual = emptyIndexGrid(9, 7); manual[2][2] = 1;
        b.floors[1].tileLayers = [{ layer: 'Floor', tiles: writeIndexGrid(manual) }];
        result = analyzeFurnishingRooms(b); above = result.rooms.find(room => room.level === 1)!;
        expect(keys(above.obstacles.find(obstacle => obstacle.kind === 'missing-floor')!.cells)).toEqual(['3:2', '4:2']);
        expect(keys(above.reservedCells)).toContain('2:2');
    });
    it('does not cut floor holes for invalid stairs or let their invalid geometry reach the planner silently', () => {
        const b = fixture(); b.floors.push({ ...b.floors[0], objects: [] });
        b.floors[0].objects = [{ uid: 'stairs', type: 'stairs', x: 1, y: 0, dir: 'W' }];
        const result = analyzeFurnishingRooms(b);
        expect(result.diagnostics.some(diagnostic => diagnostic.code === 'invalid-stairs')).toBeTrue();
        expect(result.obstacles.some(obstacle => obstacle.kind === 'missing-floor')).toBeFalse();
    });
    it('preserves unknown furniture conservatively, reserves manual tiles, and diagnoses unresolved furniture', () => {
        const b = fixture();
        b.furniture = [{ entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'custom_000' }, { x: 2, y: 0, name: 'custom_001' }] }] }];
        b.floors[0].objects = [{ uid: 'known-shape', type: 'furniture', x: 0, y: 0, orient: 'W', FurnitureTiles: 0 },
            { uid: 'unresolved', type: 'furniture', x: 0, y: 1, orient: 'W', FurnitureTiles: 4 }];
        b.user_tiles = [{ tile: 'custom_002' }];
        const manual = emptyIndexGrid(4, 3); manual[1][2] = 1;
        b.floors[0].tileLayers = [{ layer: 'Furniture', tiles: writeIndexGrid(manual) }];
        const result = analyzeFurnishingRooms(b), room = result.rooms[0];
        expect(keys(room.blockedCells)).toEqual(['0:0', '1:0', '2:0', '0:1', '2:1']);
        expect(room.availableCells).toEqual([{ x: 1, y: 1 }]);
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('unresolved-furniture');
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('manual-tile-semantics');
    });
    it('recognises curated furniture and preserves access while allowing non-blocking rugs to share floor space', () => {
        const b = fixture(Array.from({ length: 4 }, () => Array(4).fill(1)));
        const source = `group {\nlabel = Fixtures - Counters\nfurniture {\nentry {\norient = W\n0,0 = fixtures_counters_01_003\n}\n}\n}\ngroup {\nlabel = Floors - Rugs\nfurniture {\nlayer = FloorFurniture\nentry {\norient = W\n0,0 = floors_rugs_01_000\n}\n}\n}`;
        const catalog = buildFurnishingCatalog(source), counter = catalog.items.find(item => item.id === 'basic.counter')!, rug = catalog.items.find(item => item.id === 'basic.rug')!;
        b.furniture = [counter.definition, rug.definition];
        b.floors[0].objects = [{ uid: 'counter', type: 'furniture', x: 0, y: 1, orient: 'W', FurnitureTiles: 0 },
            { uid: 'rug', type: 'furniture', x: 2, y: 2, orient: 'W', FurnitureTiles: 1 }];
        const room = analyzeFurnishingRooms(b, catalog).rooms[0];
        expect(keys(room.blockedCells)).toEqual(['0:1']);
        expect(keys(room.reservedCells)).toContain('1:1');
        expect(keys(room.availableCells)).toContain('2:2');
        expect(room.obstacles.find(obstacle => obstacle.uid === 'counter')?.surfaceCells).toEqual([{ x: 0, y: 1 }]);
    });
    it('is immutable and leaves both TBX serialization and the normal renderer unchanged', () => {
        const b = fixture(), before = new XMLSerializer().serializeToString(writeBuildingFile(b));
        const projection = generateBuildingSquares(b); freeze(b);
        analyzeFurnishingRooms(b);
        expect(new XMLSerializer().serializeToString(writeBuildingFile(b))).toBe(before);
        const withStructure = generateBuildingSquares(b, true);
        expect(withStructure.tiles).toEqual(projection.tiles); expect(withStructure.objects).toEqual(projection.objects);
        expect(projection.edges).toBeUndefined();
    });
    it('requires review for unresolved footprints and structural manual tiles, including border tiles', () => {
        const b = fixture(), door = { uid: 'door', type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 };
        b.floors[0].objects = [door];
        expect(analyzeFurnishingRooms(b).rooms[0].needsReview).toBeFalse();
        b.floors[0].objects.push({ uid: 'unknown', type: 'furniture', x: 1, y: 1, orient: 'W', FurnitureTiles: 5 });
        let result = analyzeFurnishingRooms(b);
        expect(result.rooms[0].needsReview).toBeTrue();
        expect(result.diagnostics.find(diagnostic => diagnostic.code === 'unresolved-furniture')?.preventsPlanning).toBeTrue();
        b.floors[0].objects = [door]; b.user_tiles = [{ tile: 'custom-wall_000' }];
        const grid = emptyIndexGrid(4, 3); grid[1][3] = 1;
        b.floors[0].tileLayers = [{ layer: 'Walls', tiles: writeIndexGrid(grid) }];
        result = analyzeFurnishingRooms(b);
        expect(result.rooms[0].needsReview).toBeTrue();
        expect(keys(result.rooms[0].reservedCells)).toContain('2:1');
        expect(result.diagnostics.find(diagnostic => diagnostic.code === 'manual-tile-semantics')?.preventsPlanning).toBeTrue();
    });
});
