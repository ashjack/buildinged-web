import { nativeRoof30Corners } from '../testing/native-roof30.fixture';
import { nativeRoofHandles, resizeNativeRoof } from '../utils/native-roof';
import { buildRoofPlacements, defaultRoofCaps, normalizeRoofSize, resolveRoofDepth, RoofTileSet } from './roof-patterns';
import { roof30CapMatrices, roof30SlopeMatrix } from './roof-30';
import { buildingTilesCategory } from '../utils/building-tiles';

const options = (roofType: string, width: number, height: number) => ({ x: 3, y: 4, level: 1, roofType, width, height,
    tileset: { capTiles: [], slopeTiles: [], topTiles: [] } as RoofTileSet });
describe('Native 30-degree roofs', () => {
    it('joins even peaks between cells with matching end caps in both directions', () => {
        const ns = options('Peak30NS', 4, 2), we = options('Peak30WE', 2, 4);
        expect(roof30SlopeMatrix(ns).enums).toEqual([
            'Slope30W1', 'Slope30W2', 'Slope30E2', 'Slope30E1',
            'Slope30W1', 'Slope30W2', 'Slope30E2', 'Slope30E1',
        ]);
        expect(roof30SlopeMatrix(we).enums).toEqual([
            'Slope30N1', 'Slope30N1', 'Slope30N2', 'Slope30N2',
            'Slope30S2', 'Slope30S2', 'Slope30S1', 'Slope30S1',
        ]);
        expect(roof30CapMatrices(ns).map(c => c.enums)).toEqual(Array(2).fill(['CapSlope30RiseS1', 'CapSlope30RiseS2', 'CapSlope30FallS2', 'CapSlope30FallS1']));
        expect(roof30CapMatrices(we).map(c => c.enums)).toEqual(Array(2).fill(['CapSlope30FallE1', 'CapSlope30FallE2', 'CapSlope30RiseE2', 'CapSlope30RiseE1']));
        expect(roof30CapMatrices({ ...ns, cappedN: false }).map(c => c.tag)).toEqual(['cappedS']);
    });
    it('joins the four center corners of an even quad without a ridge tile', () => {
        expect(roof30SlopeMatrix(options('Peak30Quad', 4, 4)).enums).toEqual([
            'OuterSlope30NW1', 'Slope30N1', 'Slope30N1', 'OuterSlope30NE1',
            'Slope30W1', 'OuterSlope30NW2', 'OuterSlope30NE2', 'Slope30E1',
            'Slope30W1', 'OuterSlope30SW2', 'OuterSlope30SE2', 'Slope30E1',
            'OuterSlope30SW1', 'Slope30S1', 'Slope30S1', 'OuterSlope30SE1',
        ]);
        expect(roof30SlopeMatrix(options('Peak30Quad', 2, 2)).enums).toEqual(['OuterSlope30NW1', 'OuterSlope30NE1', 'OuterSlope30SW1', 'OuterSlope30SE1']);
    });
    it('uses both central slope rows for even dormers', () => {
        const o = options('Dormer30W', 2, 4);
        expect(roof30SlopeMatrix(o).enums).toEqual([
            'InnerSlope30SE1', null, 'Slope30N2', 'InnerSlope30SE2',
            'Slope30S2', 'InnerSlope30NE2', 'InnerSlope30NE1', null,
        ]);
        expect(roof30CapMatrices(o)[0].enums).toEqual(['CapSlope30FallE1', 'CapSlope30FallE2', 'CapSlope30RiseE2', 'CapSlope30RiseE1']);
    });
    for (const type of ['Peak30NS', 'Peak30WE', 'Peak30Quad', 'Dormer30W', 'Dormer30E', 'Dormer30N', 'Dormer30S']) {
        for (const span of [2, 4, 6, 8, 10, 12]) it(`fills ${type} at span ${span} using existing tile slots`, () => {
            const size = normalizeRoofSize(span, span, type), o = options(type, size.width, size.height);
            const slopes = roof30SlopeMatrix(o), caps = roof30CapMatrices(o);
            const slopeEnums = buildingTilesCategory('roof_slopes')!.enums, capEnums = buildingTilesCategory('roof_caps')!.enums;
            expect(size).toEqual({ width: span, height: span });
            expect(slopes.enums.filter(Boolean).every(name => slopeEnums.includes(name!))).toBeTrue();
            expect(slopes.enums.some(name => name?.startsWith('Peak30'))).toBeFalse();
            expect(caps.every(c => c.enums.every(name => capEnums.includes(name!)))).toBeTrue();
            const tileset = { slopeTiles: slopeEnums.map(name => ({ enum: name, tile: name })), capTiles: capEnums.map(name => ({ enum: name, tile: name })), topTiles: [] };
            const tiles = buildRoofPlacements({ ...o, ...defaultRoofCaps(type), tileset });
            expect(tiles.filter(t => t.layer === 'Roof').length).toBe(slopes.enums.filter(Boolean).length);
            if (type.startsWith('Peak')) expect(slopes.enums.filter(Boolean).length).toBe(span * span);
            if (type !== 'Peak30Quad') expect(tiles.filter(t => t.layer === 'RoofCap').length).toBe(type.startsWith('Dormer') ? span : span * 2);
            expect(tiles.every(t => t.level === 1)).toBeTrue();
        });
    }
    for (const fixture of nativeRoof30Corners) it(`matches C++ ${fixture.type} at ${fixture.size} tiles`, () => {
        expect(roof30SlopeMatrix(options(fixture.type, fixture.size, fixture.size)).enums).toEqual(fixture.tiles);
        const depths = ['Point5', 'One', 'OnePoint5', 'Two', 'TwoPoint5', 'Three'];
        expect(resolveRoofDepth(fixture.size, fixture.size, fixture.type, 'Point5')).toBe(depths[fixture.size - 1]);
    });
    it('keeps even peak and dormer spans within six slope bands', () => {
        expect(normalizeRoofSize(20, 8, 'Slope30W')).toEqual({ width: 6, height: 8 });
        expect(normalizeRoofSize(8, 20, 'Slope30S')).toEqual({ width: 8, height: 6 });
        expect(normalizeRoofSize(4, 2, 'Peak30NS')).toEqual({ width: 4, height: 2 });
        expect(normalizeRoofSize(6, 2, 'Peak30Quad')).toEqual({ width: 6, height: 6 });
        expect(normalizeRoofSize(1, 10, 'Dormer30W')).toEqual({ width: 5, height: 10 });
        expect(normalizeRoofSize(20, 2, 'Peak30NS')).toEqual({ width: 12, height: 2 });
        expect(normalizeRoofSize(2, 20, 'Peak30WE')).toEqual({ width: 2, height: 12 });
        expect(normalizeRoofSize(1, 14, 'Dormer30E')).toEqual({ width: 6, height: 14 });
        expect(normalizeRoofSize(14, 1, 'Dormer30N')).toEqual({ width: 14, height: 6 });
        expect(normalizeRoofSize(8, 2, 'CornerSlope30InnerNW')).toEqual({ width: 6, height: 6 });
        expect(resizeNativeRoof({ RoofType: 'Peak30NS' }, 4, 3, true).Depth).toBe('Zero');
    });
    it('uses dedicated ridge and quad tiles instead of standard half-depth tiles', () => {
        expect(roof30SlopeMatrix(options('Peak30NS', 5, 1)).enums).toEqual(['Slope30W1', 'Slope30W2', 'Peak30WE3', 'Slope30E2', 'Slope30E1']);
        expect(roof30SlopeMatrix(options('Peak30Quad', 3, 3)).enums).toEqual([
            'OuterSlope30NW1', 'Slope30N1', 'OuterSlope30NE1',
            'Slope30W1', 'Peak30Quad2', 'Slope30E1',
            'OuterSlope30SW1', 'Slope30S1', 'OuterSlope30SE1',
        ]);
    });
    it('joins dormers to their surrounding roof and leaves an open center above twelve tiles', () => {
        expect(roof30SlopeMatrix(options('Dormer30W', 2, 5)).enums).toEqual([
            'InnerSlope30SE1', null, 'Slope30N2', 'InnerSlope30SE2', 'Peak30NS3', 'Peak30NS3',
            'Slope30S2', 'InnerSlope30NE2', 'InnerSlope30NE1', null,
        ]);
        const o = options('Dormer30E', 6, 14), matrix = roof30SlopeMatrix(o);
        expect(matrix.enums.slice(6 * 6, 8 * 6)).toEqual(Array(12).fill(null));
        const cap = roof30CapMatrices(o)[0];
        expect(cap.tag).toBe('cappedE');
        expect(cap.enums).toEqual(['CapSlope30FallE1', 'CapSlope30FallE2', 'CapSlope30FallE3', 'CapSlope30FallE4', 'CapSlope30FallE5', 'CapSlope30FallE6',
            'CapGapE3', 'CapGapE3', 'CapSlope30RiseE6', 'CapSlope30RiseE5', 'CapSlope30RiseE4', 'CapSlope30RiseE3', 'CapSlope30RiseE2', 'CapSlope30RiseE1']);
    });
    it('places caps on the correct edges, applies offsets and uses separate overlap layers', () => {
        const o = options('Slope30N', 2, 3);
        o.tileset = { slopeTiles: [1, 2, 3].map(n => ({ enum: `Slope30N${n}`, tile: `slope_${n}`, offset: '1 -1' })),
            capTiles: [1, 2, 3].map(n => ({ enum: `CapSlope30FallE${n}`, tile: `cap_${n}` })), topTiles: [] };
        const tiles = buildRoofPlacements({ ...o, ...defaultRoofCaps(o.roofType), cappedE: false, hasRoofTile: () => true });
        expect(tiles.filter(t => t.layer === 'Roof2').length).toBe(6);
        expect(tiles[0]).toEqual(jasmine.objectContaining({ x: 4, y: 3, level: 1, name: 'slope_1.png' }));
        expect(tiles.filter(t => t.layer === 'RoofCap').map(t => [t.x, t.y, t.tag])).toEqual([[3, 4, 'cappedW'], [3, 5, 'cappedW'], [3, 6, 'cappedW']]);
        expect(tiles.every(t => t.level === 1)).toBeTrue();
    });
    it('shows only native cap handles and leaves quad peaks without cap controls', () => {
        const o = { x: 0, y: 0, width: 5, height: 5, RoofType: 'Slope30W' };
        expect(nativeRoofHandles(o).map(h => h.kind)).toEqual(['resize', 'cappedN', 'cappedS']);
        expect(nativeRoofHandles({ ...o, RoofType: 'Peak30Quad' }).map(h => h.kind)).toEqual(['resize']);
        expect(defaultRoofCaps('CornerSlope30InnerSW')).toEqual({ cappedW: false, cappedN: false, cappedE: false, cappedS: false });
    });
});
