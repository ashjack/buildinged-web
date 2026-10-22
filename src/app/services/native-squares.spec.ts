import { Building, SvgTile } from '../models/app.models';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { documentHarness } from '../testing/document-harness';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { emptyIndexGrid, writeIndexGrid } from '../utils/tbx-grid';
import { generateBuildingSquares, resolveFurniture } from './native-squares';
import { buildRoofPlacements, defaultRoofCaps, resolveRoofDepth, ROOF_OPTIONS } from './roof-patterns';
import { ViewportCanvasComponent } from '../viewport-canvas/viewport-canvas.component';

// Expected enums and pass ordering come from BuildingFloor::LayoutToSquares,
// Square::Replace*, and RoofObject::*Tiles in the supplied C++ source.
const walls = ['West', 'North', 'NorthWest', 'SouthEast', 'WestWindow', 'NorthWindow', 'WestDoor', 'NorthDoor'];
function fixture(): Building {
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    b.width = b.height = 8;
    b.entries = [];
    const entry = (category: string, names: string[], prefix = category) => {
        b.entries.push({ category, tiles: names.map(name => ({ enum: name, tile: prefix + '-' + name })) });
        return b.entries.length;
    };
    b.ExteriorWall = entry('exterior_walls', walls, 'outside');
    b.rooms[0].InteriorWall = entry('interior_walls', walls, 'inside');
    b.ExteriorWallTrim = entry('exterior_wall_trim', walls, 'outer-trim');
    b.rooms[0].InteriorWallTrim = entry('interior_wall_trim', walls, 'inner-trim');
    b.rooms[0].Floor = entry('floors', ['Floor'], 'floor');
    b.Door = entry('doors', ['West', 'North']);
    b.DoorFrame = entry('door_frames', ['West', 'North']);
    b.Window = entry('windows', ['West', 'North']);
    b.Curtains = entry('curtains', ['West', 'North', 'East', 'South']);
    b.Shutters = entry('shutters', ['NorthLeft', 'NorthRight', 'WestAbove', 'WestBelow']);
    b.Stairs = entry('stairs', ['West1', 'West2', 'West3', 'North1', 'North2', 'North3']);
    b.RoofTop = entry('roof_tops', ['West1', 'West2', 'West3']);
    b.RoofCap = entry('roof_caps', ['CapGapE1', 'CapGapS1', 'CapGapE2', 'CapGapS2', 'CapGapE3', 'CapGapS3', 'CapFallE1', 'CapFallE2', 'CapRiseE1', 'CapRiseE2']);
    b.RoofSlope = entry('roof_slopes', ['InnerOnePt5', 'SlopeOnePt5E', 'SlopeOnePt5S', 'Inner1']);
    b.GrimeWall = b.rooms[0].GrimeFloor = b.rooms[0].GrimeWall = 0;
    b.furniture = [];
    b.used_tiles = b.used_furniture = '';
    b.floors = [{ rooms: writeIndexGrid(emptyIndexGrid(8, 8)), objects: [] }];
    return b;
}
function room(b: Building, x: number, y: number, width: number, height: number, level = 0, index = 1) {
    const grid = emptyIndexGrid(b.width, b.height);
    for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) grid[j][i] = index;
    b.floors[level].rooms = writeIndexGrid(grid);
}
function tile(tiles: SvgTile[], x: number, y: number, layer: string, level = 0) {
    return tiles.find(t => t.x === x && t.y === y && t.layer === layer && t.level === level)?.name;
}
function opening(b: Building, type: 'door' | 'window', x = 1, y = 1, dir = 'W') {
    return { uid: type, type, x, y, dir, Tile: type === 'door' ? b.Door : b.Window,
        FrameTile: b.DoorFrame, CurtainsTile: b.Curtains, ShuttersTile: b.Shutters };
}
function roof(b: Building, depth = 'Zero') {
    return { uid: 'roof', type: 'roof', x: 1, y: 1, width: 2, height: 2, RoofType: 'FlatTop', Depth: depth,
        CapTiles: b.RoofCap, SlopeTiles: b.RoofSlope, TopTiles: b.RoofTop };
}

describe('Native square generation', () => {
    it('builds room north/west interiors, south/east exteriors, and the southeast corner', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'Walls')).toBe('inside-NorthWest.png');
        expect(tile(tiles, 2, 1, 'Walls')).toBe('inside-North.png');
        expect(tile(tiles, 1, 2, 'Walls')).toBe('inside-West.png');
        expect(tile(tiles, 3, 1, 'Walls')).toBe('outside-West.png');
        expect(tile(tiles, 1, 3, 'Walls')).toBe('outside-North.png');
        expect(tile(tiles, 3, 3, 'Walls')).toBe('outside-SouthEast.png');
        expect(tile(tiles, 2, 2, 'Walls')).toBeUndefined();
        expect(tile(tiles, 1, 1, 'Floor')).toBe('floor-Floor.png');
    });

    it('uses room identity for shared boundaries and treats emptyoutside# rooms as exterior', () => {
        const b = fixture(); b.rooms.push({ ...b.rooms[0] });
        const grid = emptyIndexGrid(8, 8); grid[1][1] = 1; grid[1][2] = 2;
        b.floors[0].rooms = writeIndexGrid(grid);
        expect(tile(generateBuildingSquares(b).tiles, 2, 1, 'Walls')).toBe('inside-NorthWest.png');
        b.rooms[1].Name = 'EmptyOutside#upper';
        const generated = generateBuildingSquares(b);
        expect(tile(generated.tiles, 2, 1, 'Walls')).toBe('outside-West.png');
        expect(tile(generated.tiles, 2, 1, 'Floor')).toBeUndefined();
    });

    it('overrides wall segments, splits mixed-material corners, and generates end caps', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        b.floors[0].objects.push({ uid: 'wall', type: 'wall', x: 1, y: 1, dir: 'N', length: 3,
            Tile: b.ExteriorWall, InteriorTile: b.ExteriorWall, InteriorTrim: b.ExteriorWallTrim });
        const { tiles, objects } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'Walls')).toBe('inside-North.png');
        expect(tile(tiles, 1, 1, 'Walls2')).toBe('outside-West.png');
        expect(objects[0].uid).toBe('wall');
        expect(tile(tiles, 1, 4, 'Walls')).toBe('outside-SouthEast.png');
        expect(tile(tiles, 1, 4, 'FloorGrime')).toBeUndefined();
    });

    it('splits a northwest corner around a None door and matches trim to the wall stacking order', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        b.floors[0].objects.push({ ...opening(b, 'door'), Tile: 0 });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'Doors')).toBeUndefined();
        expect(tile(tiles, 1, 1, 'Walls')).toBe('inside-North.png');
        expect(tile(tiles, 1, 1, 'Walls2')).toBe('inside-WestDoor.png');
        expect(tile(tiles, 1, 1, 'WallTrim')).toBe('inner-trim-North.png');
        expect(tile(tiles, 1, 1, 'WallTrim2')).toBe('inner-trim-WestDoor.png');
        expect(tile(tiles, 1, 1, 'Frames')).toBe('door_frames-West.png');
    });

    it('lets later openings replace the same direction while preserving perpendicular ones', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        b.floors[0].objects.push(opening(b, 'door'), opening(b, 'window'));
        let generated = generateBuildingSquares(b);
        expect(tile(generated.tiles, 1, 1, 'Doors')).toBeUndefined();
        expect(tile(generated.tiles, 1, 1, 'Windows')).toBe('windows-West.png');
        expect(tile(generated.tiles, 1, 1, 'Walls2')).toBe('inside-WestWindow.png');
        b.floors[0].objects[1].dir = 'N';
        generated = generateBuildingSquares(b);
        expect(tile(generated.tiles, 1, 1, 'Doors')).toBe('doors-West.png');
        expect(tile(generated.tiles, 1, 1, 'Walls')).toBe('inside-NorthWindow.png');
        expect(tile(generated.tiles, 1, 1, 'Walls2')).toBe('inside-WestDoor.png');
    });

    it('puts exterior-window curtains inside and shutters across exterior neighbor squares', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        b.floors[0].objects.push(opening(b, 'window', 3, 1));
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 2, 1, 'Curtains2')).toBe('curtains-East.png');
        expect(tile(tiles, 3, 1, 'Curtains')).toBeUndefined();
        expect(tile(tiles, 3, 1, 'WallFurniture')).toBe('shutters-WestAbove.png');
        expect(tile(tiles, 3, 1, 'WallFurniture2')).toBe('shutters-WestBelow.png');
        expect(tile(tiles, 3, 0, 'WallFurniture')).toBe('shutters-WestAbove.png');
        expect(tile(tiles, 3, 2, 'WallFurniture')).toBe('shutters-WestBelow.png');
    });

    it('places exterior trim only on ground floor, including southeast pieces', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        b.floors.push({ ...b.floors[0], objects: [] });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 3, 3, 'WallTrim')).toBe('outer-trim-SouthEast.png');
        expect(tile(tiles, 3, 1, 'WallTrim2', 0)).toBe('outer-trim-West.png');
        expect(tiles.some(t => t.level === 1 && t.name?.startsWith('outer-trim'))).toBeFalse();
        expect(tiles.some(t => t.level === 1 && t.name?.startsWith('inner-trim'))).toBeTrue();
    });

    it('resolves missing E and N to W, missing S to N then W, without corner fallbacks', () => {
        const b = fixture();
        b.furniture.push({ entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'west' }] }, { orient: 'N', tiles: [] }] });
        for (const orient of ['E', 'N', 'S']) expect(resolveFurniture(b, { FurnitureTiles: 0, orient })?.definition.orient).toBe('W');
        b.furniture[0].entries[1].tiles.push({ x: 0, y: 0, name: 'north' });
        expect(resolveFurniture(b, { FurnitureTiles: 0, orient: 'S' })?.definition.orient).toBe('N');
        expect(resolveFurniture(b, { FurnitureTiles: 0, orient: 'NW' })).toBeUndefined();
    });

    it('retains the newest four furniture tiles on a crowded square', () => {
        const b = fixture();
        for (let i = 0; i < 5; i++) {
            b.furniture.push({ entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'chair' + i }] }] });
            b.floors[0].objects.push({ uid: 'chair' + i, type: 'furniture', x: 1, y: 1, orient: 'W', FurnitureTiles: i });
        }
        const { tiles, objects } = generateBuildingSquares(b);
        expect(['Furniture', 'Furniture2', 'Furniture3', 'Furniture4'].map(layer => tile(tiles, 1, 1, layer))).toEqual(['chair1.png', 'chair2.png', 'chair3.png', 'chair4.png']);
        expect(objects.map(o => o.uid)).toEqual(['chair0', 'chair1', 'chair2', 'chair3', 'chair4']);
    });

    it('interns duplicate wall definitions into a northwest corner', () => {
        const b = fixture(); room(b, 1, 1, 2, 2);
        b.entries.push({ ...b.entries[b.rooms[0].InteriorWall - 1] });
        b.floors[0].objects.push({ uid: 'wall', type: 'wall', x: 1, y: 1, dir: 'N', length: 1,
            Tile: 0, InteriorTile: b.entries.length, InteriorTrim: b.rooms[0].InteriorWallTrim });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'Walls')).toBe('inside-NorthWest.png');
        expect(tile(tiles, 1, 1, 'Walls2')).toBeUndefined();
    });

    it('lets raw furniture override generated roof entries in the same section', () => {
        const b = fixture();
        b.furniture.push({ layer: 'RoofCap', entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'custom-cap' }] }] });
        b.floors[0].objects.push(roof(b, 'One'), { uid: 'cap', type: 'furniture', x: 1, y: 1, FurnitureTiles: 0, orient: 'W' });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'RoofCap')).toBe('custom-cap.png');
        expect(tile(tiles, 1, 1, 'RoofCap2')).toBe('roof_caps-CapGapS1.png');
    });

    it('uses resolved facing for overlay layers but original facing for E/S edge shifts', () => {
        const b = fixture();
        b.furniture.push({ layer: 'WallOverlay', entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'back' }] },
            { orient: 'E', tiles: [{ x: 0, y: 0, name: 'front' }] }] },
        { layer: 'Frames', entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'edge' }] }] });
        b.floors[0].objects.push({ uid: 'overlay', type: 'furniture', x: 1, y: 1, FurnitureTiles: 0, orient: 'E' },
            { uid: 'frame', type: 'furniture', x: 7, y: 1, FurnitureTiles: 1, orient: 'E' });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'WallOverlay3')).toBe('front.png');
        expect(tile(tiles, 8, 1, 'Frames')).toBe('edge.png');
    });

    it('wall furniture clears its full rectangle, preserves perpendicular walls and suppresses trim', () => {
        const b = fixture(); room(b, 1, 1, 2, 3);
        b.furniture.push({ layer: 'Walls', entries: [{ orient: 'W', grime: false,
            tiles: [{ x: 0, y: 0, name: 'replacement' }, { x: 0, y: 2, name: 'replacement' }] }] });
        b.floors[0].objects.push({ uid: 'replace', type: 'furniture', x: 1, y: 1, FurnitureTiles: 0, orient: 'W' });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 1, 1, 'Walls')).toBe('inside-North.png');
        expect(tile(tiles, 1, 1, 'Walls2')).toBe('replacement.png');
        expect(tile(tiles, 1, 1, 'WallTrim2')).toBeUndefined();
        expect(tile(tiles, 1, 2, 'Walls')).toBeUndefined();
        expect(tile(tiles, 1, 3, 'Walls')).toBe('replacement.png');
    });

    for (const dir of ['W', 'N']) it(`draws three ${dir} stair steps and cuts only their floor squares above`, () => {
        const b = fixture(); room(b, 0, 0, 8, 8);
        b.floors.push({ ...b.floors[0], objects: [] });
        b.floors[0].objects.push({ uid: 'stairs', type: 'stairs', x: 1, y: 1, dir, Tile: b.Stairs });
        const { tiles, objects } = generateBuildingSquares(b);
        for (let i = 1; i <= 3; i++) {
            const x = 1 + (dir === 'W' ? i : 0), y = 1 + (dir === 'N' ? i : 0);
            expect(tile(tiles, x, y, 'Furniture')).toBe('stairs-' + (dir === 'W' ? 'West' : 'North') + (4 - i) + '.png');
            expect(tile(tiles, x, y, 'Floor', 1)).toBeUndefined();
            expect(tile(tiles, x, y, 'Floor', 0)).toBe('floor-Floor.png');
        }
        expect(tile(tiles, 1, 1, 'Floor', 1)).toBe('floor-Floor.png');
        expect(objects[0].tiles.length).toBe(3);
    });

    it('keeps an out-of-bounds stair opening intact and draws manual floor repairs above valid stairs', () => {
        const b = fixture(); room(b, 0, 0, 8, 8);
        b.floors.push({ ...b.floors[0], objects: [] });
        b.floors[0].objects.push({ uid: 'stairs', type: 'stairs', x: 6, y: 1, dir: 'W', Tile: b.Stairs });
        expect(tile(generateBuildingSquares(b).tiles, 7, 1, 'Floor', 1)).toBe('floor-Floor.png');
        b.floors[0].objects[0].x = 1;
        const manual = emptyIndexGrid(9, 9); manual[1][2] = 1;
        b.floors[1].tileLayers = [{ layer: 'Floor', tiles: writeIndexGrid(manual) }];
        const scene = documentHarness(b); scene.grid.setSelectedLevel(1); scene.grid.redrawTiles();
        const drawTile = jasmine.createSpy('drawTile');
        ViewportCanvasComponent.prototype.drawTiles.call({ gridService: scene.grid, drawTile,
            getIndividualTile: (name: string) => name } as any);
        expect(drawTile).toHaveBeenCalledWith(2, 1, b.user_tiles[0].tile + '.png', b.user_tiles[0].tile + '.png');
        scene.destroy();
    });

    it('preserves explicit flat roof height, cap faces, and floor-above placement', () => {
        for (const depth of ['Zero', 'One', 'Two', 'Three']) {
            const b = fixture(); b.floors.push({ rooms: b.floors[0].rooms, objects: [] });
            b.floors[0].objects.push(roof(b, depth));
            const { tiles } = generateBuildingSquares(b);
            const topLevel = depth === 'Three' ? 1 : 0, layer = ['Zero', 'Three'].includes(depth) ? 'Floor' : 'RoofTop';
            expect(tile(tiles, 1, 1, layer, topLevel)).toBe('roof_tops-West' + (depth === 'One' ? 1 : depth === 'Two' ? 2 : 3) + '.png');
            expect(tiles.some(t => t.layer === 'RoofCap')).toBe(depth !== 'Zero');
        }
    });

    it('applies roof offsets before clipping and ignores manual layers for generated stacking', () => {
        const b = fixture(); const o = roof(b, 'One'); o.x = 7; o.width = 1;
        b.entries[b.RoofTop - 1].tiles.find(t => t.enum === 'West1')!.offset = '1 -1';
        b.floors[0].objects.push(o, { ...o, uid: 'roof2' });
        const { tiles } = generateBuildingSquares(b);
        expect(tile(tiles, 8, 0, 'RoofTop')).toBe('roof_tops-West1.png');
        expect(tiles.every(t => t.x >= 0 && t.x <= 8 && t.y >= 0 && t.y <= 8)).toBeTrue();
    });

    it('generates stable projections through save/reopen and rebuild, with manual tiles taking precedence', () => {
        const b = fixture(); room(b, 1, 1, 2, 2); b.floors[0].objects.push(opening(b, 'door'));
        const grid = emptyIndexGrid(9, 9); grid[1][1] = 1;
        b.floors[0].tileLayers = [{ layer: 'Walls2', tiles: writeIndexGrid(grid) }];
        const scene = documentHarness(b);
        expect(scene.grid.getTileAt(1, 1, 0, 'Walls2')?.name).toBe(b.user_tiles[0].tile + '.png');
        const before = generateBuildingSquares(scene.buildings.building).tiles.map(({ object, ...t }) => t);
        const reopened = readBuildingFile(writeBuildingFile(scene.buildings.building));
        expect(generateBuildingSquares(reopened).tiles.map(({ object, ...t }) => t)).toEqual(before);
        scene.destroy();
    });
});

describe('Native roof definitions', () => {
    it('uses native default cap flags when creating roofs', () => {
        expect(defaultRoofCaps('CornerOuterSW')).toEqual({ cappedW: false, cappedN: false, cappedE: false, cappedS: false });
        expect(defaultRoofCaps('SlopeW').cappedE).toBeFalse();
        expect(defaultRoofCaps('ShallowSlopeN').cappedS).toBeFalse();
        expect(Object.values(defaultRoofCaps('PeakNS')).every(Boolean)).toBeTrue();
    });
    it('retains half depths for slopes and corners, derives peak depth, and preserves flat depth', () => {
        expect(resolveRoofDepth(2, 4, 'SlopeE', 'OnePoint5')).toBe('OnePoint5');
        expect(resolveRoofDepth(2, 2, 'CornerInnerNW', 'Point5')).toBe('OnePoint5');
        expect(resolveRoofDepth(5, 4, 'PeakNS', 'One')).toBe('TwoPoint5');
        expect(resolveRoofDepth(4, 4, 'FlatTop', 'Two')).toBe('Two');
    });

    it('uses native half-depth cap omissions and cap-only faces for hidden corners', () => {
        const b = fixture();
        const cap = buildRoofPlacements({ x: 1, y: 1, width: 2, height: 2, level: 0, roofType: 'CornerInnerSE', depth: 'OnePoint5',
            tileset: { capTiles: b.entries[b.RoofCap - 1].tiles, slopeTiles: [], topTiles: [] } });
        expect(cap.filter(t => t.tag === 'cappedW').map(t => t.name)).toEqual(['roof_caps-CapFallE1.png']);
        expect(cap.every(t => t.layer === 'RoofCap')).toBeTrue();
    });

    it('supports all roof families and caps without invalid tile names or coordinates', () => {
        const b = fixture();
        for (const option of ROOF_OPTIONS) {
            for (let size = 1; size <= 8; size++) {
                const tiles = buildRoofPlacements({ x: 0, y: 0, level: 0, width: size, height: size, roofType: option.roofType,
                    tileset: { capTiles: b.entries[b.RoofCap - 1].tiles, slopeTiles: b.entries[b.RoofSlope - 1].tiles, topTiles: b.entries[b.RoofTop - 1].tiles } });
                expect(tiles.every(t => Number.isInteger(t.x) && Number.isInteger(t.y) && t.name !== 'undefined.png' && t.name !== '.png')).toBeTrue();
            }
        }
    });
});
