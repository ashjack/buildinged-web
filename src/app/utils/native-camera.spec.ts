import { NATIVE_ZOOM_FACTORS, buildingCameraBounds, constrainCamera, nativeWheelZoom, safeZoom, wheelAngle, zoomAroundPoint } from './native-camera';
import { Building } from '../models/app.models';

describe('Native zoom and camera bounds', () => {
    it('walks the ZOMBOID zoom stops and never goes through zero or beyond the native limits', () => {
        let zoom = 4;
        const stops = [zoom];
        for (let i = 1; i < NATIVE_ZOOM_FACTORS.length; i++) { zoom = nativeWheelZoom(zoom, -120); stops.push(zoom); }
        expect(stops).toEqual([...NATIVE_ZOOM_FACTORS].reverse());
        for (let i = 0; i < 100; i++) zoom = nativeWheelZoom(zoom, -120);
        expect(zoom).toBe(0.06);
        for (let i = 0; i < 100; i++) zoom = nativeWheelZoom(zoom, 120);
        expect(zoom).toBe(4); expect(safeZoom(NaN)).toBe(1); expect(safeZoom(-1)).toBe(0.06);
    });
    it('normalizes browser wheel units and follows Zoomable fine-resolution rounding', () => {
        expect(wheelAngle(100, 0)).toBe(-120); expect(wheelAngle(3, 1)).toBe(-120); expect(wheelAngle(1, 2)).toBe(-120);
        expect(nativeWheelZoom(1, 60)).toBe(1.15); expect(nativeWheelZoom(1, -60)).toBe(0.8696);
        expect(nativeWheelZoom(1.15, 120)).toBe(1.5); expect(nativeWheelZoom(4, 1)).toBe(4);
        expect(nativeWheelZoom(0.06, -1)).toBe(0.06);
    });
    it('centers a scene that fits and clamps larger axes to their scroll ranges', () => {
        const bounds = { left: 100, right: 500, top: 200, bottom: 1200 }, viewport = { width: 800, height: 300 };
        expect(constrainCamera({ x: -1e6, y: -1e6 }, 1, bounds, viewport)).toEqual({ x: -100, y: 200 });
        expect(constrainCamera({ x: 1e6, y: 1e6 }, 1, bounds, viewport)).toEqual({ x: -100, y: 900 });
        expect(constrainCamera({ x: NaN, y: Infinity }, 1, bounds, viewport)).toEqual({ x: -100, y: 550 });
    });
    it('keeps the world point under the pointer fixed while zooming', () => {
        const old = { x: 1234, y: -95 }, anchor = { x: 740, y: 225 }, oldZoom = 0.75, nextZoom = 1.5;
        const next = zoomAroundPoint(old, oldZoom, nextZoom, anchor);
        expect(next.x + anchor.x / nextZoom).toBeCloseTo(old.x + anchor.x / oldZoom);
        expect(next.y + anchor.y / nextZoom).toBeCloseTo(old.y + anchor.y / oldZoom);
    });
    it('includes the wall border, all floor levels, and committed sprite overhangs in scene bounds', () => {
        const building = { width: 2, height: 4, floors: [{}, {}, {}] } as Building;
        expect(buildingCameraBounds(building, 0, [])).toEqual({ left: 2000, right: 2800, top: -600, bottom: 400 });
        expect(buildingCameraBounds(building, 2, [])).toEqual({ left: 2000, right: 2800, top: 0, bottom: 1000 });
        const bounds = buildingCameraBounds(building, 0, [
            { x: -10, y: -10, level: 0, layer: 'Furniture', url: '' }, { x: 20, y: 0, level: 0, layer: 'Floor', url: '' },
        ]);
        expect(bounds.top).toBe(-1308); expect(bounds.right).toBe(4602);
    });
});
