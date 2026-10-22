import { Point, TileArea } from '../models/app.models';
import { normalizeRoofSize, resolveRoofDepth } from '../services/roof-patterns';

export type RoofHandleKind = 'resize' | 'depthUp' | 'depthDown' | 'cappedW' | 'cappedN' | 'cappedE' | 'cappedS';
export interface RoofHandle { kind: RoofHandleKind; bounds: TileArea; crossed: boolean; }
export const isHalfRoof = (o: any) => ['Point5', 'OnePoint5', 'TwoPoint5'].includes(o.Depth);
export const roofRect = (o: any): TileArea => ({ x: Number(o.x), y: Number(o.y), width: Number(o.width), height: Number(o.height) });
export function resizeNativeRoof(o: any, width: number, height: number, half: boolean): any {
    const size = normalizeRoofSize(width, height, o.RoofType);
    const saved = o.RoofType === 'FlatTop' ? o.Depth : half ? 'Point5' : undefined;
    return { ...o, ...size, Depth: resolveRoofDepth(size.width, size.height, o.RoofType, saved) };
}
/** GraphicsRoofHandleItem::calcBoundingRect and synchWithObject. */
export function nativeRoofHandles(o: any): RoofHandle[] {
    const r = roofRect(o), t = o.RoofType, right = r.x + r.width, bottom = r.y + r.height;
    const handles: RoofHandle[] = [{ kind: 'resize', bounds: { x: right - 0.5, y: bottom - 0.5, width: 0.5, height: 0.5 }, crossed: false }];
    if (t === 'FlatTop') {
        const x = r.x + r.width / 2 - 7 / 30, y = r.y + r.height / 2;
        handles.push({ kind: 'depthUp', bounds: { x, y: y - 14 / 30, width: 14 / 30, height: 14 / 30 }, crossed: o.Depth === 'Three' },
            { kind: 'depthDown', bounds: { x, y, width: 14 / 30, height: 14 / 30 }, crossed: o.Depth === 'Zero' });
    }
    const hidden = {
        W: ['SlopeW', 'PeakNS', 'DormerE', 'DormerN', 'DormerS', 'ShallowSlopeW', 'ShallowPeakNS', 'CornerOuterNW', 'CornerOuterSW'],
        N: ['SlopeN', 'PeakWE', 'DormerW', 'DormerE', 'DormerS', 'ShallowSlopeN', 'ShallowPeakWE', 'CornerOuterNW', 'CornerOuterNE'],
        E: ['SlopeE', 'PeakNS', 'DormerW', 'DormerN', 'DormerS', 'ShallowSlopeE', 'ShallowPeakNS', 'CornerOuterNE', 'CornerOuterSE'],
        S: ['SlopeS', 'PeakWE', 'DormerW', 'DormerE', 'DormerN', 'ShallowSlopeS', 'ShallowPeakWE', 'CornerOuterSW', 'CornerOuterSE'],
    };
    for (const side of ['W', 'N', 'E', 'S'] as const) {
        if (hidden[side].includes(t)) continue;
        const vertical = side === 'W' || side === 'E';
        const bounds = vertical ? { x: side === 'W' ? r.x : right - 0.5, y: r.y + 0.5, width: 0.5, height: r.height - 1 }
            : { x: r.x + 0.5, y: side === 'N' ? r.y : bottom - 0.5, width: r.width - 1, height: 0.5 };
        if (bounds.width > 0 && bounds.height > 0) handles.push({ kind: `capped${side}`, bounds, crossed: o[`capped${side}`] === false || o[`capped${side}`] === 'false' });
    }
    return handles;
}
/** RoofTool's fractional half-depth rules; Qt angles increase counterclockwise. */
export function nativeRoofHalfDepth(o: any, width: number, height: number, p: Point, creating: boolean, dx = 0, dy = 0): boolean {
    const x = Math.floor(p.x), y = Math.floor(p.y), fx = p.x - x, fy = p.y - y;
    const t = o.RoofType;
    let w = width, h = height;
    if (t.startsWith('Corner') || t === 'SlopeW' || t === 'SlopeE') w = Math.min(3, w);
    if (t.startsWith('Corner') || t === 'SlopeN' || t === 'SlopeS') h = Math.min(3, h);
    const inside = x >= Number(o.x) && y >= Number(o.y) && x < Number(o.x) + w && y < Number(o.y) + h;
    if (t === 'CornerOuterSE' || t === 'CornerInnerNW') {
        const angle = (Math.atan2(Number(o.y) - p.y, p.x - Number(o.x)) * 180 / Math.PI + 360) % 360;
        let half = angle >= 315 ? inside && fx < 0.5 : angle >= 270 ? inside && fy < 0.5 : true;
        if (creating && angle >= 270 && (dx < 0 || dy < 0)) half = !half;
        return half;
    }
    if (t === 'SlopeW' || t === 'SlopeE') {
        const half = inside ? fx < 0.5 : x < Number(o.x);
        return t === 'SlopeE' ? !half : half;
    }
    if (t === 'SlopeN' || t === 'SlopeS') {
        const half = inside ? fy < 0.5 : y < Number(o.y);
        return t === 'SlopeS' ? !half : half;
    }
    return false;
}
