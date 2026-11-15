import type { Point, TileArea } from '../models/app.models';
import type { TileClip } from '../utils/tile-clip';

export interface CompoundRoof {
    x: number; y: number; width: number; height: number; roofType: string;
    RoofRotation?: number | string; RoofMirror?: boolean | string; RoofWingWidth?: number | string;
    RoofMainWidth?: number | string; RoofReturnWidth?: number | string;
}
type Face = 'W' | 'N' | 'E' | 'S';
export const isCompoundRoof = (type: string) => /^(L|T)Roof(30)?$/.test(type);
export const compoundRoofRotation = (o: Pick<CompoundRoof, 'RoofRotation'>) => {
    const angle = Number(o.RoofRotation);
    return Number.isFinite(angle) ? ((Math.trunc(angle) % 4) + 4) % 4 : 0;
};
export const compoundRoofMirrored = (o: Pick<CompoundRoof, 'RoofMirror'>) => o.RoofMirror === true || o.RoofMirror === 'true';
export const compoundRoofSlopeSpan = (type: string) => type.endsWith('30') ? 12 : 6;
// Leave a notch inside the editor's 256-tile building area.
export const compoundRoofMaxWing = (type: string) => type.startsWith('L') ? 255 : compoundRoofSlopeSpan(type);
const wingWidth = (value: number, max: number) => Math.max(1, Math.floor(Math.min(max, value)));

/** Automatic widths retain the existing defaults; explicit widths can be any whole tile. */
export function compoundRoofWing(o: CompoundRoof): number {
    const r = compoundRoofRotation(o), w = r % 2 ? o.height : o.width, h = r % 2 ? o.width : o.height;
    const available = Math.min(compoundRoofMaxWing(o.roofType), w - (o.roofType.startsWith('T') ? 2 : 1), h - 1);
    const requested = Number(o.RoofWingWidth) || Math.min(compoundRoofSlopeSpan(o.roofType), Math.max(2, Math.floor(Math.min(w, h) / 4) * 2));
    return wingWidth(requested, available);
}

export function compoundRoofWings(o: CompoundRoof): { main: number; return: number } {
    const shared = compoundRoofWing(o);
    const r = compoundRoofRotation(o), w = r % 2 ? o.height : o.width, h = r % 2 ? o.width : o.height;
    const automatic = Math.min(compoundRoofSlopeSpan(o.roofType), Math.max(2, Math.floor(Math.min(w, h) / 4) * 2));
    const resolve = (value: number | string | undefined, available: number) => value === undefined ? shared
        : wingWidth(Number(value) || automatic, Math.min(compoundRoofMaxWing(o.roofType), available));
    return { main: resolve(o.RoofMainWidth, h - 1), return: resolve(o.RoofReturnWidth, w - (o.roofType.startsWith('T') ? 2 : 1)) };
}

export function normalizeCompoundRoofSize(width: number, height: number, type: string, rotation = 0, wing = 0,
    mainWidth?: number | string, returnWidth?: number | string) {
    const size = (value: number) => value ? wingWidth(value, compoundRoofMaxWing(type)) : 2;
    const a = size(Number(mainWidth ?? wing));
    const b = size(Number(returnWidth ?? wing));
    const minW = b + (type.startsWith('T') ? 2 : 1), minH = a + 1;
    return { width: Math.max(rotation % 2 ? minH : minW, width), height: Math.max(rotation % 2 ? minW : minH, height) };
}

function geometry(o: CompoundRoof) {
    const rotation = compoundRoofRotation(o), width = Number(rotation % 2 ? o.height : o.width), height = Number(rotation % 2 ? o.width : o.height);
    const { main, return: wing } = compoundRoofWings(o), stem = o.roofType.startsWith('L') ? width - wing : Math.floor((width - wing) / 2);
    const point = (x: number, y: number): Point => {
        if (compoundRoofMirrored(o)) x = width - x;
        const p = rotation === 1 ? { x: height - y, y: x } : rotation === 2 ? { x: width - x, y: height - y }
            : rotation === 3 ? { x: y, y: width - x } : { x, y };
        return { x: Number(o.x) + p.x, y: Number(o.y) + p.y };
    };
    const rect = (x: number, y: number, w: number, h: number): TileArea => {
        const a = point(x, y), b = point(x + w, y + h);
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    };
    return { width, height, main, wing, stem, point, rects: [rect(0, 0, width, main), rect(stem, 0, wing, height)] };
}

export function compoundRoofOutline(o: CompoundRoof): Point[] {
    const { width: w, height: h, main: a, wing: b, stem: s, point } = geometry(o);
    const vertices = o.roofType.startsWith('L')
        ? [[0, 0], [w, 0], [w, h], [w - b, h], [w - b, a], [0, a]]
        : [[0, 0], [w, 0], [w, a], [s + b, a], [s + b, h], [s, h], [s, a], [0, a]];
    return vertices.map(([x, y]) => point(x, y));
}

export function compoundRoofContains(o: CompoundRoof, p: Point): boolean {
    return geometry(o).rects.some(r => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height);
}

export function compoundRoofIntersects(o: CompoundRoof, area: TileArea): boolean {
    return geometry(o).rects.some(r => r.x < area.x + area.width && r.x + r.width > area.x && r.y < area.y + area.height && r.y + r.height > area.y);
}

export interface CompoundRoofPart { tile: string; clip: TileClip; }
export interface CompoundRoofCell { x: number; y: number; tile: string | null; face: string; parts?: CompoundRoofPart[]; }

export function compoundRoofCells(o: CompoundRoof): CompoundRoofCell[] {
    const { rects } = geometry(o), cells = new Set<string>();
    // The upper envelope joins both hipped wings: convex hips on the outside, concave valleys inside.
    const sample = (x: number, y: number): { height: number; face: Face } => {
        let result = { height: -Infinity, face: 'N' as Face };
        for (const r of rects) {
            if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
            const distances: [number, Face][] = [[x - r.x, 'W'], [y - r.y, 'N'], [r.x + r.width - x, 'E'], [r.y + r.height - y, 'S']];
            const nearest = distances.reduce((a, b) => a[0] <= b[0] ? a : b);
            if (nearest[0] > result.height) result = { height: nearest[0], face: nearest[1] };
        }
        return result;
    };
    const result: CompoundRoofCell[] = [];
    for (const r of rects) for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
        const key = `${x},${y}`; if (cells.has(key)) continue; cells.add(key);
        const cx = x + .5, cy = y + .5, height = sample(cx, cy).height;
        // Like native wide peaks, stop the slopes at one storey and fill the centre with Roof Top tiles.
        if (height > compoundRoofSlopeSpan(o.roofType) / 2) {
            result.push({ x, y, tile: 'West3', face: 'Top' }); continue;
        }
        const faces = new Set<Face>();
        for (const dx of [-.2, .2]) for (const dy of [-.2, .2]) faces.add(sample(cx + dx, cy + dy).face);
        const band = Math.ceil(height - 1e-6), shallow = o.roofType.endsWith('30');
        const ns = faces.has('N') && faces.has('S'), we = faces.has('W') && faces.has('E');
        const halfDepth = ['Pt5', 'OnePt5', 'TwoPt5'][band - 1];
        const peak = (axis: 'NS' | 'WE') => shallow ? `Peak30${axis}${band}` : `Slope${halfDepth}${axis === 'NS' ? 'S' : 'E'}`;
        if (ns || we) {
            if (faces.size === 2) {
                result.push({ x, y, tile: peak(ns ? 'NS' : 'WE'), face: ns ? 'NS' : 'WE' }); continue;
            }
            const bend = sample(cx - .2, cy).height + sample(cx + .2, cy).height + sample(cx, cy - .2).height + sample(cx, cy + .2).height - 4 * height;
            if (faces.size === 4 && bend < -1e-6) {
                result.push({ x, y, tile: shallow ? `Peak30Quad${band}` : `Outer${halfDepth}`, face: 'Quad' }); continue;
            }
            // A ridge end or valley junction combines at most two native half-join sprites.
            // Clip their facets in sprite space so neither paints over the other wing.
            const groups: { tile: string | null; faces: Face[] }[] = [];
            if (ns) groups.push({ tile: peak('NS'), faces: ['N', 'S'] });
            if (we) groups.push({ tile: peak('WE'), faces: ['W', 'E'] });
            if (!ns || !we) {
                const third = [...faces].find(f => ns ? f === 'W' || f === 'E' : f === 'N' || f === 'S')!;
                groups.push({ tile: shallow ? `Slope30${third}${band}` : third === 'E' || third === 'S' ? `Slope${third}${band}` : null, faces: [third] });
            }
            const parts: CompoundRoofPart[] = groups.filter(g => g.tile).map(g => ({ tile: g.tile!, clip: [] }));
            const active = groups.filter(g => g.tile);
            const project = (p: Point): Point => ({ x: (32 + (p.x - p.y) * 32) / 64,
                y: (96 + (p.x + p.y) * 16 - sample(x + p.x, y + p.y).height * (shallow ? 16 : 32)) / 128 });
            for (const u of [0, .5]) for (const v of [0, .5]) {
                const center = { x: u + .25, y: v + .25 }, corners = [{ x: u, y: v }, { x: u + .5, y: v }, { x: u + .5, y: v + .5 }, { x: u, y: v + .5 }];
                for (let i = 0; i < 4; i++) {
                    const triangle = [center, corners[i], corners[(i + 1) % 4]], middle = triangle.reduce((p, q) => ({ x: p.x + q.x / 3, y: p.y + q.y / 3 }), { x: 0, y: 0 });
                    const face = sample(x + middle.x, y + middle.y).face;
                    if (!shallow && face !== 'E' && face !== 'S') continue;
                    const index = active.findIndex(g => g.faces.includes(face));
                    if (index >= 0) parts[index].clip.push(triangle.map(project));
                }
            }
            const visible = parts.filter(p => p.clip.length);
            result.push({ x, y, tile: visible[0]?.tile || null, face: [...faces].join(''), parts: visible }); continue;
        }
        let tile: string | null = null, face: string = [...faces][0];
        if (faces.size === 1) tile = shallow ? `Slope30${face}${band}` : face === 'E' || face === 'S' ? `Slope${face}${band}` : null;
        else {
            const corner = `${faces.has('N') ? 'N' : 'S'}${faces.has('W') ? 'W' : 'E'}`;
            const bend = sample(cx - .2, cy).height + sample(cx + .2, cy).height + sample(cx, cy - .2).height + sample(cx, cy + .2).height - 4 * height;
            const inner = bend > 1e-6, opposite: Record<string, string> = { NW: 'SE', NE: 'SW', SE: 'NW', SW: 'NE' };
            face = corner;
            if (shallow) tile = `${inner ? 'Inner' : 'Outer'}Slope30${inner ? opposite[corner] : corner}${band}`;
            // The standard atlas paints east/south faces; its north/west slopes are hidden in the isometric view.
            else if (inner) tile = corner === 'SE' ? `Inner${band}` : faces.has('E') ? `SlopeE${band}` : faces.has('S') ? `SlopeS${band}` : null;
            else tile = corner === 'SE' ? `Outer${band}` : corner === 'SW' ? `CornerSW${band}` : corner === 'NE' ? `CornerNE${band}` : null;
        }
        result.push({ x, y, tile, face });
    }
    return result.sort((a, b) => a.y - b.y || a.x - b.x);
}
