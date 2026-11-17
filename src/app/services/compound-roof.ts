import type { Point, TileArea } from '../models/app.models';
import type { TileClip } from '../utils/tile-clip';

export interface CompoundRoof {
    x: number; y: number; width: number; height: number; roofType: string;
    RoofRotation?: number | string; RoofMirror?: boolean | string; RoofWingWidth?: number | string;
    RoofMainWidth?: number | string; RoofReturnWidth?: number | string;
}
type Face = 'W' | 'N' | 'E' | 'S';
export const isCompoundRoof = (type: string) => /^(?:[LT]Roof|LRoofOpen)(30)?$/.test(type);
export const isOpenCompoundRoof = (type: string) => /^LRoofOpen(30)?$/.test(type);
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
    const rects = [rect(0, 0, width, main), rect(stem, 0, wing, height)];
    const direction = (x: number, y: number): Face => {
        const a = point(0, 0), b = point(x, y);
        return b.x < a.x ? 'W' : b.x > a.x ? 'E' : b.y < a.y ? 'N' : 'S';
    };
    const ends = isOpenCompoundRoof(o.roofType) ? [{ rect: rects[0], side: direction(-1, 0) }, { rect: rects[1], side: direction(0, 1) }] : [];
    return { width, height, main, wing, stem, point, rects, ends };
}
export const compoundRoofEnds = (o: CompoundRoof) => geometry(o).ends;

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

function surface(o: CompoundRoof) {
    const shape = geometry(o), { rects, ends } = shape;
    // Omit only the two free end planes for open roofs. The elbow keeps its hip and valley.
    const sample = (x: number, y: number): { height: number; face: Face } => {
        let result = { height: -Infinity, face: 'N' as Face };
        for (const [index, r] of rects.entries()) {
            if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
            const distances: [number, Face][] = [[x - r.x, 'W'], [y - r.y, 'N'], [r.x + r.width - x, 'E'], [r.y + r.height - y, 'S']];
            const nearest = distances.filter(([, face]) => face !== ends[index]?.side).reduce((a, b) => a[0] <= b[0] ? a : b);
            if (nearest[0] > result.height) result = { height: nearest[0], face: nearest[1] };
        }
        return result;
    };
    return { ...shape, sample };
}

export interface CompoundRoofCap { x: number; y: number; tile: string; side: Face; clip?: TileClip; }
/** Native cap enums along the actual free-end profile, including odd-width half peaks. */
export function compoundRoofCaps(o: CompoundRoof): CompoundRoofCap[] {
    const { ends, sample } = surface(o), result: CompoundRoofCap[] = [];
    const shallow = o.roofType.endsWith('30'), limit = compoundRoofSlopeSpan(o.roofType) / 2;
    for (const { rect: r, side } of ends) {
        const vertical = side === 'W' || side === 'E', axis = vertical ? 'E' : 'S';
        for (let p = 0; p < (vertical ? r.height : r.width); p++) {
            const x = r.x + (side === 'E' ? r.width : vertical ? 0 : p);
            const y = r.y + (side === 'S' ? r.height : vertical ? p : 0);
            const height = (fraction: number) => Math.min(limit, sample(x + (vertical ? 0 : fraction), y + (vertical ? fraction : 0)).height);
            const a = height(0), middle = height(.5), b = height(1), band = Math.ceil(middle);
            if (!(middle > 0)) continue;
            let tile: string, clip: TileClip | undefined;
            if (middle > Math.max(a, b)) tile = shallow ? `CapPeak30${axis}${band}` : `Peak${['Pt5', 'OnePt5', 'TwoPt5'][band - 1]}${axis}`;
            else if (a !== b) tile = `${shallow ? 'CapSlope30' : 'Cap'}${(a < b) === vertical ? 'Fall' : 'Rise'}${axis}${Math.ceil(Math.max(a, b))}`;
            else {
                const physicalHeight = middle * (shallow ? .5 : 1);
                tile = `CapGap${axis}${Math.ceil(physicalHeight)}`;
                // A short wing can limit a 30-degree gable to a half-storey cap height.
                if (!Number.isInteger(physicalHeight)) {
                    const project = (fraction: number, h: number): Point => ({ x: (32 + (vertical ? -fraction : fraction) * 32) / 64,
                        y: (96 + fraction * 16 - h * 32) / 128 });
                    clip = [[project(0, physicalHeight), project(1, physicalHeight), project(1, 0), project(0, 0)]];
                }
            }
            result.push({ x, y, tile, side, ...(clip ? { clip } : {}) });
        }
    }
    return result;
}

export function compoundRoofCells(o: CompoundRoof): CompoundRoofCell[] {
    const { rects, sample } = surface(o), cells = new Set<string>();
    const result: CompoundRoofCell[] = [];
    for (const r of rects) for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
        const key = `${x},${y}`; if (cells.has(key)) continue; cells.add(key);
        const cx = x + .5, cy = y + .5, height = sample(cx, cy).height;
        // Like native wide peaks, stop the slopes at one storey and fill the centre with Roof Top tiles.
        if (height > compoundRoofSlopeSpan(o.roofType) / 2) {
            result.push({ x, y, tile: 'West3', face: 'Top' }); continue;
        }
        const faces = new Set<Face>();
        // Unequal binary fractions stay off x+y/x-y seam lines. Symmetric probes
        // can land on a zero-area contact between the wings and invent a corner
        // face on an otherwise continuous slope (depending on world position).
        // Sample both sides of each diagonal as well as every quadrant, retaining
        // all four faces at a pyramid peak and all facets at a ridge junction.
        for (const [a, b] of [[.1875, .28125], [.28125, .1875]]) {
            for (const dx of [-a, a]) for (const dy of [-b, b]) faces.add(sample(cx + dx, cy + dy).face);
        }
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
                    // A triangle centroid can also lie exactly on a contact line.
                    const face = sample(x + middle.x + 1 / 1048576, y + middle.y + 1 / 524288).face;
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
