import { Building, Point, SvgTile } from '../models/app.models';

/** Zoomable's ZOMBOID zoom factors. Canvas geometry retains the web renderer's scene units. */
export const NATIVE_ZOOM_FACTORS = [0.06, 0.12, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export interface CameraBounds { left: number; top: number; right: number; bottom: number; }
export interface ViewportSize { width: number; height: number; }
export function safeZoom(zoom: number): number { return Number.isFinite(zoom) ? Math.max(0.06, Math.min(4, zoom)) : 1; }

/** Zoomable::handleWheelDelta, with bounded fine-resolution input and four decimal places. */
export function nativeWheelZoom(zoom: number, angleDelta: number): number {
    zoom = safeZoom(zoom);
    if (!Number.isFinite(angleDelta) || !angleDelta) return zoom;
    if (angleDelta >= 120) return NATIVE_ZOOM_FACTORS.find(factor => factor > zoom) ?? zoom;
    if (angleDelta <= -120) return [...NATIVE_ZOOM_FACTORS].reverse().find(factor => factor < zoom) ?? zoom;
    const factor = 1 + 0.3 * Math.abs(angleDelta) / 120;
    return Math.round(safeZoom(zoom * (angleDelta < 0 ? 1 / factor : factor)) * 10000) / 10000;
}
/** DOM wheel units: a standard wheel notch is 100 pixels, 3 lines, or one page. */
export function wheelAngle(delta: number, mode: number): number { return -delta * (mode === 1 ? 40 : mode === 2 ? 120 : 1.2); }
export function wheelScroll(delta: number, mode: number, viewportLength: number): number {
    return delta * (mode === 1 ? viewportLength / 20 : mode === 2 ? viewportLength : 1);
}

/** QGraphicsView scroll ranges and default AlignCenter for an axis that fits. */
export function constrainCamera(offset: Point, zoom: number, bounds: CameraBounds, viewport: ViewportSize): Point {
    zoom = safeZoom(zoom);
    const axis = (value: number, low: number, high: number, pixels: number) => {
        const visible = pixels / zoom;
        if (!Number.isFinite(value) || high - low <= visible) return (low + high - visible) / 2;
        return Math.max(low, Math.min(high - visible, value));
    };
    return { x: axis(offset.x, bounds.left, bounds.right, viewport.width), y: axis(offset.y, bounds.top, bounds.bottom, viewport.height) };
}
export function zoomAroundPoint(offset: Point, oldZoom: number, newZoom: number, anchor: Point): Point {
    return { x: offset.x + anchor.x / safeZoom(oldZoom) - anchor.x / safeZoom(newZoom),
        y: offset.y + anchor.y / safeZoom(oldZoom) - anchor.y / safeZoom(newZoom) };
}

/** BuildingMap's one-cell wall border, all floor levels, and CompositeLayerGroup sprite margins.
 * Coordinates match this canvas: a cell basis of (100,50), origin (2500,0),
 * three cells between floors, and 204x408 tile sprites. Cursor overlays don't expand the scene. */
export function buildingCameraBounds(building: Building | undefined, level: number, tiles: SvgTile[]): CameraBounds {
    const width = (building?.width ?? 20) + 1, height = (building?.height ?? 20) + 1;
    const topLevel = Math.max(0, (building?.floors.length ?? 1) - 1);
    const bounds = { left: 2500 - height * 100, right: 2500 + width * 100,
        top: (level - topLevel) * 300, bottom: (width + height) * 50 + level * 300 };
    for (const tile of tiles) {
        const difference = level - tile.level;
        const x = tile.x + difference * 3 + (tile.offsetX || 0) + difference * 0.05;
        const y = tile.y + difference * 3 + (tile.offsetY || 0) + difference * 0.05;
        const left = 2500 + (x - y) * 100 - 102, top = (x + y) * 50 - 308;
        if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
        bounds.left = Math.min(bounds.left, left); bounds.right = Math.max(bounds.right, left + 204);
        bounds.top = Math.min(bounds.top, top); bounds.bottom = Math.max(bounds.bottom, top + 408);
    }
    return bounds;
}
