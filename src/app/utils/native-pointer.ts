import { Point, TileArea } from '../models/app.models';

/** Invert the isometric cell basis. Polygon order is SE, NE, NW, SW. */
export function fractionalCellPosition(point: Point, polygon: Point[]): Point {
    const origin = polygon[2], a = { x: polygon[1].x - origin.x, y: polygon[1].y - origin.y },
        b = { x: polygon[3].x - origin.x, y: polygon[3].y - origin.y };
    const x = point.x - origin.x, y = point.y - origin.y, determinant = a.x * b.y - a.y * b.x;
    return { x: (x * b.y - y * b.x) / determinant, y: (a.x * y - a.y * x) / determinant };
}
/** BaseObjectTool::mouseMoveEvent's tile-space distances and tie-breaking. */
export function nativeTileEdge(p: Point): 'W' | 'N' | 'E' | 'S' {
    const w = p.x, n = p.y, e = 1 - p.x, s = 1 - p.y;
    return w < e ? w < n && w < s ? 'W' : n < s ? 'N' : 'S'
        : e < n && e < s ? 'E' : n < s ? 'N' : 'S';
}
export function nativeWallCorner(p: Point): 'NW' | 'NE' | 'SW' | 'SE' {
    return p.y >= 0.5 ? p.x > 0.5 ? 'SE' : 'SW' : p.x > 0.5 ? 'NE' : 'NW';
}
export function rectanglePoints(r: TileArea): Point[] {
    return [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y },
        { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
}
export function nativeWallShape(o: any): TileArea {
    return o.dir === 'N' ? { x: Number(o.x) - 0.2, y: Number(o.y), width: 0.4, height: Number(o.length) }
        : { x: Number(o.x), y: Number(o.y) - 0.2, width: Number(o.length), height: 0.4 };
}
export function nativeWallHandles(o: any): TileArea[] {
    const r = nativeWallShape(o);
    return [{ ...r, width: 0.4, height: 0.4 },
        { x: r.x + r.width - 0.4, y: r.y + r.height - 0.4, width: 0.4, height: 0.4 }];
}
export function insideRectangle(r: TileArea, p: Point): boolean {
    const epsilon = 1e-8;
    return p.x >= r.x - epsilon && p.y >= r.y - epsilon && p.x <= r.x + r.width + epsilon && p.y <= r.y + r.height + epsilon;
}
