import { compoundRoofCells, compoundRoofContains, compoundRoofOutline, compoundRoofWing, compoundRoofWings, normalizeCompoundRoofSize } from './compound-roof';
import { buildRoofPlacements, ROOF_OPTIONS } from './roof-patterns';
import { buildingTilesCategory } from '../utils/building-tiles';
import { ROOF_TOOL_GROUPS, roofToolGroup } from '../utils/roof-toolbar';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { BuildingTransform, transformBuilding } from '../utils/building-transform';
import { generateBuildingSquares } from './native-squares';
import { buildingPreviewTiles } from '../utils/building-preview';
import { GridService } from './grid.service';

const roof = (roofType = 'LRoof30', width = 8, height = 10) => ({ x: 0, y: 0, width, height, roofType, RoofRotation: 0, RoofMirror: false, RoofWingWidth: 4 });
describe('L and T hipped roofs', () => {
    it('keeps all four choices in the main roof dropdown without adding a toolbar group', () => {
        const options = ROOF_OPTIONS.filter(o => ['LRoof', 'TRoof', 'LRoof30', 'TRoof30'].includes(o.roofType));
        expect(options.map(o => o.label)).toEqual(['L-Roof', 'T-Roof', 'L-Roof (30°)', 'T-Roof (30°)']);
        expect(options.every(o => roofToolGroup(o) === 'standard' && ROOF_TOOL_GROUPS[0].options.includes(o))).toBeTrue();
        expect(ROOF_TOOL_GROUPS.length).toBe(5);
    });
    it('creates an L with an empty notch and a T with two empty sides below its header', () => {
        const l = roof(), t = roof('TRoof30', 10, 10);
        expect(compoundRoofOutline(l).length).toBe(6); expect(compoundRoofOutline(t).length).toBe(8);
        expect(compoundRoofCells(l).length).toBe(56); expect(compoundRoofCells(t).length).toBe(64);
        expect(compoundRoofContains(l, { x: .5, y: 7.5 })).toBeFalse();
        expect(compoundRoofContains(l, { x: 6.5, y: 7.5 })).toBeTrue();
        expect(compoundRoofContains(t, { x: .5, y: 7.5 })).toBeFalse();
        expect(compoundRoofContains(t, { x: 9.5, y: 7.5 })).toBeFalse();
        expect(compoundRoofContains(t, { x: 4.5, y: 7.5 })).toBeTrue();
    });
    it('uses inside valley and outside hip tiles at the wing junctions', () => {
        const cells = compoundRoofCells(roof('LRoof30', 8, 8));
        expect(cells.find(c => c.x === 4 && c.y === 3)?.tile).toBe('InnerSlope30NE1');
        expect(cells.find(c => c.x === 5 && c.y === 2)?.tile).toBe('InnerSlope30NE2');
        expect(cells.find(c => c.x === 6 && c.y === 1)?.tile).toBe('OuterSlope30NE2');
        const t = compoundRoofCells(roof('TRoof30', 10, 10));
        expect(t.some(c => c.tile?.startsWith('InnerSlope30NW'))).toBeTrue();
        expect(t.some(c => c.tile?.startsWith('InnerSlope30NE'))).toBeTrue();
    });
    it('maintains a notch for minimum sizes and respects requested wing widths', () => {
        expect(normalizeCompoundRoofSize(1, 1, 'LRoof')).toEqual({ width: 3, height: 3 });
        expect(normalizeCompoundRoofSize(1, 1, 'TRoof')).toEqual({ width: 4, height: 3 });
        expect(normalizeCompoundRoofSize(1, 1, 'TRoof30', 1, 8)).toEqual({ width: 9, height: 10 });
        expect(compoundRoofWing(roof('LRoof', 20, 20))).toBe(4);
        expect(compoundRoofWing({ ...roof('LRoof', 20, 20), RoofWingWidth: 12 })).toBe(12);
        expect(compoundRoofWing({ ...roof('LRoof30', 20, 20), RoofWingWidth: 12 })).toBe(12);
    });
    it('keeps legacy automatic widths and shared-width roofs unchanged', () => {
        expect(compoundRoofWings({ ...roof('LRoof', 40, 40), RoofWingWidth: 0 })).toEqual({ main: 6, return: 6 });
        expect(compoundRoofWings({ ...roof('LRoof30', 40, 40), RoofWingWidth: 0 })).toEqual({ main: 12, return: 12 });
        const legacy = roof('LRoof', 12, 14);
        expect(compoundRoofCells({ ...legacy, RoofMainWidth: 4, RoofReturnWidth: 4 })).toEqual(compoundRoofCells(legacy));
    });
    it('uses independent main and return widths, including the empty notch and minimum footprint', () => {
        const o = { ...roof('LRoof', 20, 24), RoofMainWidth: 6, RoofReturnWidth: 10 };
        expect(compoundRoofWings(o)).toEqual({ main: 6, return: 10 });
        expect(compoundRoofCells(o).length).toBe(300);
        expect(compoundRoofOutline(o)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 24 }, { x: 10, y: 24 }, { x: 10, y: 6 }, { x: 0, y: 6 }]);
        expect(compoundRoofContains(o, { x: 2.5, y: 6.5 })).toBeFalse();
        expect(compoundRoofContains(o, { x: 10.5, y: 20.5 })).toBeTrue();
        expect(compoundRoofCells({ ...o, RoofMainWidth: 10, RoofReturnWidth: 6 }).length).toBe(284);
        expect(normalizeCompoundRoofSize(1, 1, 'LRoof', 0, 0, 16, 8)).toEqual({ width: 9, height: 17 });
        expect(normalizeCompoundRoofSize(1, 1, 'LRoof30', 1, 0, 16, 8)).toEqual({ width: 17, height: 9 });
        expect(normalizeCompoundRoofSize(1, 1, 'LRoof', 0, 0, 300, 300)).toEqual({ width: 256, height: 256 });
    });
    for (const type of ['LRoof', 'LRoof30', 'TRoof30']) {
        it(`keeps every integer wing width for ${type} and uses native half joins for odd ridges`, () => {
            for (let width = 1; width <= (type.startsWith('L') ? 15 : 11); width++) {
                const o = { ...roof(type, 24, 26), RoofWingWidth: width,
                    ...(type.startsWith('L') ? { RoofMainWidth: width, RoofReturnWidth: 3 } : {}) };
                expect(compoundRoofWings(o).main).withContext(String(width)).toBe(width);
                const enums = buildingTilesCategory('roof_slopes')!.enums;
                for (const cell of compoundRoofCells(o)) {
                    const parts = cell.parts || (cell.tile ? [{ tile: cell.tile }] : []);
                    expect(parts.every(p => cell.face === 'Top' ? p.tile === 'West3' : enums.includes(p.tile))).withContext(`${type}/${width}/${cell.x},${cell.y}`).toBeTrue();
                    expect(parts.length).toBeLessThanOrEqual(2);
                }
            }
            const cells = compoundRoofCells({ ...roof(type, 16, 18), RoofWingWidth: 5, ...(type.startsWith('L') ? { RoofMainWidth: 5, RoofReturnWidth: 3 } : {}) });
            expect(cells.some(c => (c.parts || [{ tile: c.tile }]).some(p => type.endsWith('30') ? p.tile === 'Peak30NS3' || p.tile === 'Peak30WE3' : p.tile === 'SlopeTwoPt5S' || p.tile === 'SlopeTwoPt5E'))).toBeTrue();
            expect(cells.some(c => c.parts?.some(p => p.clip.length))).toBeTrue();
        });
    }
    for (const main of [1, 3, 4, 5, 7]) for (const ret of [1, 3, 4, 5]) {
        it(`keeps ${main}/${ret} L-roof wings exact through rotation, mirroring and serialization`, () => {
            const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')); b.width = b.height = 32;
            b.floors = [{ rooms: '', objects: [{ ...roof('LRoof30', 12, 14), type: 'roof', RoofType: 'LRoof30', x: 3, y: 4,
                RoofMainWidth: main, RoofReturnWidth: ret, RoofRotation: 1, RoofMirror: true }] }];
            const o = b.floors[0].objects[0], cells = compoundRoofCells(o);
            expect(compoundRoofWings(o)).toEqual({ main, return: ret });
            const saved = readBuildingFile(writeBuildingFile(b)).floors[0].objects[0];
            expect(compoundRoofCells({ ...saved, roofType: saved.RoofType, x: +saved.x, y: +saved.y, width: +saved.width, height: +saved.height })).toEqual(cells);
            for (const operation of ['rotate-right', 'rotate-left', 'flip-horizontal', 'flip-vertical'] as BuildingTransform[]) {
                const transformed = transformBuilding(b, operation).floors[0].objects[0];
                const expected = cells.map(p => operation === 'rotate-right' ? `${b.height - p.y - 1},${p.x}`
                    : operation === 'rotate-left' ? `${p.y},${b.width - p.x - 1}` : operation === 'flip-horizontal' ? `${b.width - p.x - 1},${p.y}` : `${p.x},${b.height - p.y - 1}`).sort();
                expect(compoundRoofCells({ ...transformed, roofType: transformed.RoofType }).map(p => `${p.x},${p.y}`).sort()).toEqual(expected);
            }
        });
    }
    for (const type of ['LRoof', 'LRoof30']) for (const rotation of [0, 1, 2, 3]) {
        it(`fills wide unequal ${type} wings at rotation ${rotation} with real slope and roof-top enums`, () => {
            const o = { ...roof(type, 32, 34), RoofRotation: rotation, RoofMirror: true, RoofMainWidth: 16, RoofReturnWidth: 14 };
            const cells = compoundRoofCells(o), enums = buildingTilesCategory('roof_slopes')!.enums;
            const tileset = { slopeTiles: enums.map(name => ({ enum: name, tile: name })), capTiles: [], topTiles: [{ enum: 'West3', tile: 'flat-top' }] };
            expect(cells.filter(c => c.face === 'Top').length).toBeGreaterThan(0);
            expect(cells.every(c => c.face === 'Top' ? c.tile === 'West3' : !c.tile || enums.includes(c.tile))).toBeTrue();
            const tiles = buildRoofPlacements({ ...o, level: 0, tileset });
            expect(tiles.length).toBe(cells.filter(c => c.tile).length);
            expect(tiles.every(t => t.name === 'flat-top.png' ? t.layer === 'Floor' && t.level === 1 && t.tag === 'compound-roof-top' : t.layer === 'Roof' && t.level === 0)).toBeTrue();
            expect(new Set(tiles.map(t => `${t.x},${t.y}`)).size).toBe(tiles.length);
            expect(tiles.every(t => compoundRoofContains(o, { x: t.x + .5, y: t.y + .5 }))).toBeTrue();
        });
    }
    for (const type of ['LRoof', 'LRoof30']) it(`preserves wide unequal ${type} wings in the editor, TileZed preview, save/reopen and transforms`, () => {
        const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')); b.width = b.height = 64;
        b.entries = [{ category: 'roof_slopes', tiles: buildingTilesCategory('roof_slopes')!.enums.map(name => ({ enum: name, tile: name })) },
            { category: 'roof_tops', tiles: [{ enum: 'West3', tile: 'flat-top' }] }];
        const o = { ...roof(type, 26, 30), type: 'roof', RoofType: type, uid: 'wide-roof', x: 4, y: 5, RoofMainWidth: 16, RoofReturnWidth: 8, SlopeTiles: 1, TopTiles: 2 };
        b.floors = [{ rooms: '', objects: [o] }];
        const before = generateBuildingSquares(b).tiles, preview = buildingPreviewTiles(b);
        expect(before.some(t => t.level === 1 && t.name === 'flat-top.png' && t.object === o.uid)).toBeTrue();
        expect(preview).toEqual(before); expect(b.floors.length).toBe(1);
        const grid = new GridService(null!, null!); spyOn(grid, 'getIndividualTile').and.callFake(name => name);
        grid.setSelectedLevel(0); grid.roomTiles = before;
        grid.userTiles = [{ name: 'upstairs-furniture.png', url: '', x: 1, y: 1, level: 1, layer: 'Furniture' }]; grid.redrawTiles();
        expect(grid.tiles.some(t => t.name === 'flat-top.png')).toBeTrue();
        expect(grid.tiles.some(t => t.name === 'upstairs-furniture.png')).toBeFalse();
        const saved = readBuildingFile(writeBuildingFile(b));
        const geometry = (tiles: typeof before) => tiles.map(({ object, ...tile }) => tile);
        expect(geometry(generateBuildingSquares(saved).tiles)).toEqual(geometry(before));
        for (const operation of ['rotate-right', 'rotate-left', 'flip-horizontal', 'flip-vertical'] as BuildingTransform[]) {
            const transformed = transformBuilding(b, operation).floors[0].objects[0];
            const expected = compoundRoofCells(o).map(p => operation === 'rotate-right' ? `${b.height - p.y - 1},${p.x}`
                : operation === 'rotate-left' ? `${p.y},${b.width - p.x - 1}` : operation === 'flip-horizontal' ? `${b.width - p.x - 1},${p.y}` : `${p.x},${b.height - p.y - 1}`).sort();
            expect(compoundRoofCells({ ...transformed, roofType: transformed.RoofType }).map(p => `${p.x},${p.y}`).sort()).toEqual(expected);
        }
    });
    for (const type of ['LRoof', 'TRoof', 'LRoof30', 'TRoof30']) for (const rotation of [0, 1, 2, 3]) {
        it(`generates ${type} at rotation ${rotation} without duplicate tiles, internal caps or filled cutouts`, () => {
            const o = { ...roof(type, 16, 18), RoofRotation: rotation };
            const enums = buildingTilesCategory('roof_slopes')!.enums;
            const tileset = { slopeTiles: enums.map(name => ({ enum: name, tile: name })), capTiles: [], topTiles: [] };
            const tiles = buildRoofPlacements({ ...o, level: 1, tileset });
            expect(tiles.length).toBeGreaterThan(0);
            expect(tiles.every(t => t.layer === 'Roof' && t.level === 1 && compoundRoofContains(o, { x: t.x + .5, y: t.y + .5 }))).toBeTrue();
            expect(new Set(tiles.map(t => `${t.x},${t.y}`)).size).toBe(tiles.length);
            expect(compoundRoofCells(o).filter(c => c.tile).every(c => enums.includes(c.tile!))).toBeTrue();
            if (type.endsWith('30')) expect(tiles.length).toBe(compoundRoofCells(o).length);
        });
    }
    it('preserves shape settings and geometry through save/reopen and building transforms', () => {
        const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')); b.width = 30; b.height = 32;
        const o = { ...roof('TRoof30', 9, 12), type: 'roof', RoofType: 'TRoof30', x: 4, y: 5, Depth: 'Zero', CapTiles: 0, SlopeTiles: 0, TopTiles: 0 };
        b.floors[0].objects = [o]; b.floors[0].rooms = Array(30 * 32).fill(0).join(','); b.floors[0].tileLayers = [];
        const saved = readBuildingFile(writeBuildingFile(b)).floors[0].objects[0];
        expect(compoundRoofCells({ ...saved, roofType: saved.RoofType, x: +saved.x, y: +saved.y, width: +saved.width, height: +saved.height })).toEqual(compoundRoofCells(o));
        const positions = (a: any) => compoundRoofCells({ ...a, roofType: a.RoofType }).map(p => `${p.x},${p.y}`).sort();
        for (const operation of ['rotate-right', 'rotate-left', 'flip-horizontal', 'flip-vertical'] as BuildingTransform[]) {
            const transformed = transformBuilding(b, operation).floors[0].objects[0];
            const expected = compoundRoofCells(o).map(p => operation === 'rotate-right' ? `${b.height - p.y - 1},${p.x}`
                : operation === 'rotate-left' ? `${p.y},${b.width - p.x - 1}` : operation === 'flip-horizontal' ? `${b.width - p.x - 1},${p.y}` : `${p.x},${b.height - p.y - 1}`).sort();
            expect(positions(transformed)).withContext(operation).toEqual(expected);
        }
    });
});
