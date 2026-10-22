import { fractionalCellPosition, nativeTileEdge, nativeWallCorner, nativeWallHandles, nativeWallShape } from './native-pointer';

describe('Native BuildingEd pointer rules', () => {
    it('uses tile-space edge distances and native tie-breaking', () => {
        expect(nativeTileEdge({ x: 0.1, y: 0.4 })).toBe('W');
        expect(nativeTileEdge({ x: 0.4, y: 0.1 })).toBe('N');
        expect(nativeTileEdge({ x: 0.9, y: 0.4 })).toBe('E');
        expect(nativeTileEdge({ x: 0.4, y: 0.9 })).toBe('S');
        expect(nativeTileEdge({ x: 0.5, y: 0.5 })).toBe('S');
        expect(nativeTileEdge({ x: 0.2, y: 0.2 })).toBe('N');
        expect(nativeTileEdge({ x: 0.8, y: 0.8 })).toBe('S');
    });

    it('rounds wall intersections independently on both axes, including asymmetric half-cell ties', () => {
        expect(nativeWallCorner({ x: 0.49, y: 0.49 })).toBe('NW');
        expect(nativeWallCorner({ x: 0.51, y: 0.49 })).toBe('NE');
        expect(nativeWallCorner({ x: 0.49, y: 0.51 })).toBe('SW');
        expect(nativeWallCorner({ x: 0.51, y: 0.51 })).toBe('SE');
        expect(nativeWallCorner({ x: 0.5, y: 0.5 })).toBe('SW');
    });

    it('recovers fractional positions from isometric screen coordinates at different zooms and pans', () => {
        for (const zoom of [0.5, 1, 2]) {
            const screen = (x: number, y: number) => ({ x: 307 + (x - y) * 100 * zoom, y: 83 + (x + y) * 50 * zoom });
            const polygon = [screen(1, 1), screen(1, 0), screen(0, 0), screen(0, 1)];
            const p = fractionalCellPosition(screen(0.32, 0.71), polygon);
            expect(p.x).toBeCloseTo(0.32, 8); expect(p.y).toBeCloseTo(0.71, 8);
        }
    });

    it('uses the native 12/30 wall thickness and resize-handle dimensions', () => {
        const wall = { x: 2, y: 3, dir: 'W', length: 4 };
        expect(nativeWallShape(wall)).toEqual({ x: 2, y: 2.8, width: 4, height: 0.4 });
        expect(nativeWallHandles(wall)[0]).toEqual({ x: 2, y: 2.8, width: 0.4, height: 0.4 });
        expect(nativeWallHandles(wall)[1].x).toBeCloseTo(5.6);
        expect(nativeWallShape({ ...wall, dir: 'N' })).toEqual({ x: 1.8, y: 3, width: 0.4, height: 4 });
    });
});
