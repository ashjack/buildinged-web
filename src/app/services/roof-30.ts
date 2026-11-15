import type { RoofPlacementOptions } from './roof-patterns';

type Side = 'W' | 'N' | 'E' | 'S';
interface Matrix {
    rect: { x: number; y: number; width: number; height: number };
    enums: (string | null)[];
    tag?: string;
}
export const isRoof30 = (type: string) => type.includes('30');

/** Six slope bands: odd spans use a ridge tile; even spans join between cells. */
export function normalizeRoof30(width: number, height: number, type: string) {
    width = Math.max(1, width); height = Math.max(1, height);
    if (type === 'Slope30W' || type === 'Slope30E') width = Math.min(6, width);
    if (type === 'Slope30N' || type === 'Slope30S') height = Math.min(6, height);
    if (type === 'Peak30WE') height = Math.min(12, height);
    if (type === 'Peak30NS') width = Math.min(12, width);
    if (type === 'Peak30Quad') width = height = Math.min(12, Math.max(width, height));
    if (type === 'Dormer30W' || type === 'Dormer30E') {
        width = Math.max(width, Math.min(6, Math.floor(height / 2)));
    }
    if (type === 'Dormer30N' || type === 'Dormer30S') {
        height = Math.max(height, Math.min(6, Math.floor(width / 2)));
    }
    if (type.startsWith('Corner')) width = height = Math.min(6, Math.max(width, height));
    return { width, height };
}

/** Native roof tiles, extending the original patterns with between-cell even joins. */
export function roof30SlopeMatrix(o: RoofPlacementOptions): Matrix {
    const { x, y, width: w, height: h, roofType: t } = o;
    const enums: (string | null)[] = Array(w * h).fill(null);
    const set = (cx: number, cy: number, name: string) => { if (cx >= 0 && cy >= 0 && cx < w && cy < h) enums[cy * w + cx] = name; };
    const peak = (p: number, span: number, axis: string, near: string, far: string) => span % 2 === 1 && p === Math.floor(span / 2)
        ? `Peak30${axis}${(span + 1) / 2}` : `Slope30${p < span / 2 ? near : far}${Math.min(p + 1, span - p)}`;
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
        if (/^Slope30/.test(t)) {
            const side = t.slice(-1), band = side === 'W' ? cx + 1 : side === 'E' ? w - cx : side === 'N' ? cy + 1 : h - cy;
            set(cx, cy, `Slope30${side}${band}`);
        } else if (t === 'Peak30WE') set(cx, cy, peak(cy, h, 'NS', 'N', 'S'));
        else if (t === 'Peak30NS') set(cx, cy, peak(cx, w, 'WE', 'W', 'E'));
        else if (t === 'Peak30Quad') {
            const d = Math.min(cx, cy, w - cx - 1, h - cy - 1), band = d + 1;
            const west = cx === d, east = cx === w - d - 1, north = cy === d, south = cy === h - d - 1;
            set(cx, cy, w % 2 === 1 && d === Math.floor(w / 2) ? `Peak30Quad${band}` :
                (west || east) && (north || south) ? `OuterSlope30${north ? 'N' : 'S'}${west ? 'W' : 'E'}${band}` :
                    `Slope30${north ? 'N' : south ? 'S' : west ? 'W' : 'E'}${band}`);
        } else if (t.startsWith('Corner')) {
            const side = t.slice(-2), inner = t.includes('Inner');
            let name: string;
            if (side === 'NW') name = cx === cy ? `${inner ? 'Inner' : 'Outer'}Slope30NW${inner ? w - cx : cx + 1}` :
                inner ? (cx > cy ? `Slope30S${h - cy}` : `Slope30E${w - cx}`) : (cx > cy ? `Slope30N${cy + 1}` : `Slope30W${cx + 1}`);
            else if (side === 'SE') name = cx === cy ? `${inner ? 'Inner' : 'Outer'}Slope30SE${inner ? cx + 1 : w - cx}` :
                inner ? (cx > cy ? `Slope30W${cx + 1}` : `Slope30N${cy + 1}`) : (cx > cy ? `Slope30E${w - cx}` : `Slope30S${h - cy}`);
            else if (side === 'SW') name = cx + cy === w - 1 ? `${inner ? 'Inner' : 'Outer'}Slope30SW${inner ? w - cx : cx + 1}` :
                inner ? (cx + cy < w - 1 ? `Slope30E${w - cx}` : `Slope30N${cy + 1}`) : (cx + cy < w - 1 ? `Slope30W${cx + 1}` : `Slope30S${h - cy}`);
            else name = cx + cy === w - 1 ? `${inner ? 'Inner' : 'Outer'}Slope30NE${inner ? cx + 1 : cy + 1}` :
                inner ? (cx + cy < w - 1 ? `Slope30S${h - cy}` : `Slope30W${cx + 1}`) : (cx + cy < w - 1 ? `Slope30N${cy + 1}` : `Slope30E${w - cx}`);
            set(cx, cy, name);
        }
    }
    if (t.startsWith('Dormer30')) {
        const side = t.slice(-1), horizontal = side === 'W' || side === 'E', span = horizontal ? h : w;
        if (span <= 11 && span % 2 === 1) {
            for (let p = 0; p < (horizontal ? w : h); p++)
                set(horizontal ? p : Math.floor(w / 2), horizontal ? Math.floor(h / 2) : p, `Peak30${horizontal ? 'NS' : 'WE'}${(span + 1) / 2}`);
        }
        let join = side === 'W' ? w - 1 : side === 'N' ? h - 1 : 0;
        for (let band = Math.min(6, Math.floor(span / 2)); band >= 1; band--, join += side === 'W' || side === 'N' ? -1 : 1) {
            const near = band - 1, far = span - band;
            if (horizontal) {
                set(join, near, `InnerSlope30S${side === 'W' ? 'E' : 'W'}${band}`);
                set(join, far, `InnerSlope30N${side === 'W' ? 'E' : 'W'}${band}`);
                for (let p = side === 'W' ? 0 : join + 1; p < (side === 'W' ? join : w); p++) {
                    set(p, near, `Slope30N${band}`); set(p, far, `Slope30S${band}`);
                }
            } else {
                set(near, join, `InnerSlope30${side === 'N' ? 'S' : 'N'}E${band}`);
                set(far, join, `InnerSlope30${side === 'N' ? 'S' : 'N'}W${band}`);
                for (let p = side === 'N' ? 0 : join + 1; p < (side === 'N' ? join : h); p++) {
                    set(near, p, `Slope30W${band}`); set(far, p, `Slope30E${band}`);
                }
            }
        }
    }
    return { rect: { x, y, width: w, height: h }, enums };
}

export function roof30CapMatrices(o: RoofPlacementOptions): Matrix[] {
    const t = o.roofType, result: Matrix[] = [];
    const sequence = (length: number, axis: string, rise: boolean) => Array.from({ length }, (_, p) => `CapSlope30${rise ? 'Rise' : 'Fall'}${axis}${(axis === 'E' ? rise : !rise) ? length - p : p + 1}`);
    const ridge = (length: number, axis: string) => Array.from({ length }, (_, p) => {
        const band = Math.min(p + 1, length - p);
        if (length <= 11 && length % 2 === 1 && p === Math.floor(length / 2)) return `CapPeak30${axis}${(length + 1) / 2}`;
        if (band > 6) return `CapGap${axis}3`;
        return `CapSlope30${(p < length / 2) === (axis === 'E') ? 'Fall' : 'Rise'}${axis}${band}`;
    });
    const corners: Record<string, Partial<Record<Side, [string, boolean]>>> = {
        InnerSW: { E: ['E', false], N: ['S', false] }, InnerNW: { E: ['E', true], S: ['S', false] },
        InnerNE: { W: ['E', true], S: ['S', true] }, InnerSE: { W: ['E', false], N: ['S', true] },
        OuterSW: { E: ['E', true], N: ['S', true] }, OuterNW: { E: ['E', false], S: ['S', true] },
        OuterNE: { W: ['E', false], S: ['S', false] }, OuterSE: { W: ['E', true], N: ['S', false] },
    };
    for (const side of ['W', 'E', 'N', 'S'] as Side[]) {
        if (o[`capped${side}`] === false) continue;
        const vertical = side === 'W' || side === 'E', length = vertical ? o.height : o.width, axis = vertical ? 'E' : 'S';
        let enums: string[] = [];
        if ((vertical && ['Slope30N', 'Slope30S'].includes(t)) || (!vertical && ['Slope30W', 'Slope30E'].includes(t)))
            enums = sequence(length, axis, t === 'Slope30S' || t === 'Slope30W');
        if (t === (vertical ? 'Peak30WE' : 'Peak30NS') || t === `Dormer30${side}`) enums = ridge(length, axis);
        const corner = corners[t.replace('CornerSlope30', '')]?.[side];
        if (corner) enums = sequence(length, ...corner);
        if (enums.length) result.push({ rect: { x: o.x + (side === 'E' ? o.width : 0), y: o.y + (side === 'S' ? o.height : 0),
            width: vertical ? 1 : o.width, height: vertical ? o.height : 1 }, enums, tag: `capped${side}` });
    }
    return result;
}
