import { Building, TileArea } from '../models/app.models';
import { resolveFurniture } from '../services/native-squares';
import { emptyIndexGrid, gridContains, readIndexGrid, writeIndexGrid } from './tbx-grid';

export interface TileCellEdit { x: number; y: number; tile: string | null; }
export interface SelectionEdit {
    mode: 'objects' | 'rooms' | 'tiles'; level: number; dx: number; dy: number;
    uids?: string[]; area?: TileArea; layer?: string; erase?: boolean;
    allFloors?: boolean; includeObjects?: boolean;
}
export function contains(area: TileArea, x: number, y: number): boolean {
    return x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height;
}
export function objectBounds(b: Building, o: any): TileArea {
    const f = o.type === 'furniture' ? resolveFurniture(b, o) : undefined;
    return { x: Number(o.x), y: Number(o.y),
        width: o.type === 'roof' ? Number(o.width) : o.type === 'wall' && o.dir !== 'N' ? Number(o.length)
            : o.type === 'stairs' && o.dir === 'W' ? 5 : f?.width || 1,
        height: o.type === 'roof' ? Number(o.height) : o.type === 'wall' && o.dir === 'N' ? Number(o.length)
            : o.type === 'stairs' && o.dir === 'N' ? 5 : f?.height || 1 };
}
export function validObject(b: Building, o: any): boolean {
    const r = objectBounds(b, o);
    // Stairs::isValidPos has no border; WallObject only permits its wall-facing border.
    const width = b.width + (o.type === 'stairs' || o.type === 'wall' && o.dir !== 'N' ? 0 : 1);
    const height = b.height + (o.type === 'stairs' || o.type === 'wall' && o.dir === 'N' ? 0 : 1);
    return [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.width > 0 && r.height > 0
        && r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height;
}

/** A brush stroke/stamp is committed once, with one palette update and one grid write. */
export function paintTileCells(b: Building, level: number, layer: string, cells: TileCellEdit[]): Building {
    if (!b.floors[level] || !layer) return b;
    const floor = b.floors[level], layers = floor.tileLayers || [], previous = layers.find(l => l.layer === layer);
    const rows = previous ? readIndexGrid(previous.tiles, b.width + 1, b.height + 1) : emptyIndexGrid(b.width + 1, b.height + 1);
    const palette = [...b.user_tiles];
    let changed = false;
    for (const cell of cells) {
        if (!gridContains(b.width + 1, b.height + 1, cell.x, cell.y) || cell.tile === '') continue;
        const name = cell.tile?.replace(/\.png$/, '');
        let index = 0;
        if (name !== undefined) {
            index = palette.findIndex(t => t.tile === name) + 1;
            if (!index) { palette.push({ tile: name }); index = palette.length; }
        }
        if (rows[cell.y][cell.x] !== index) { rows[cell.y][cell.x] = index; changed = true; }
    }
    if (!changed) return b;
    const updated = { layer, tiles: writeIndexGrid(rows) };
    return { ...b, user_tiles: palette, floors: b.floors.map((f, i) => i === level ? { ...f,
        tileLayers: previous ? layers.map(l => l === previous ? updated : l) : [...layers, updated] } : f) };
}

/** Snapshot first, clear the source, then write the destination, including empty cells. */
export function transformSelection(b: Building, edit: SelectionEdit): Building {
    const { level, dx, dy, mode, area, erase } = edit;
    if (!b.floors[level] || ![dx, dy].every(Number.isSafeInteger) || (!erase && !dx && !dy)) return b;
    const width = b.width + (mode === 'tiles' ? 1 : 0), height = b.height + (mode === 'tiles' ? 1 : 0);
    if (mode !== 'objects') {
        if (!area || ![area.x, area.y, area.width, area.height].every(Number.isSafeInteger) || area.width < 1 || area.height < 1
            || area.x < 0 || area.y < 0 || area.x + area.width > width || area.y + area.height > height
            || (!erase && (area.x + dx < 0 || area.y + dy < 0 || area.x + area.width + dx > width || area.y + area.height + dy > height))) return b;
        if (mode === 'tiles' && !edit.layer) return b;
    }
    const ids = new Set(edit.uids);
    const affected = (index: number) => index === level || mode === 'rooms' && edit.allFloors;
    const selected = (o: any) => mode === 'objects' ? ids.has(o.uid) : mode === 'rooms' && edit.includeObjects && area && contains(area, Number(o.x), Number(o.y));
    if (!erase && b.floors.some((f, i) => affected(i) && f.objects.some(o => selected(o) && !validObject(b, { ...o, x: Number(o.x) + dx, y: Number(o.y) + dy })))) return b;
    const floors = b.floors.map((floor, index) => {
        if (!affected(index)) return floor;
        let changed = false;
        const objects = floor.objects.flatMap(o => {
            if (!selected(o)) return [o];
            changed = true;
            return erase ? [] : [{ ...o, x: Number(o.x) + dx, y: Number(o.y) + dy }];
        });
        if (mode === 'objects') return changed ? { ...floor, objects } : floor;
        const layer = floor.tileLayers?.find(l => l.layer === edit.layer);
        if (mode === 'tiles' && !layer) return floor;
        const text = mode === 'rooms' ? floor.rooms : layer!.tiles;
        const rows = readIndexGrid(text, width, height), snapshot = rows.map(row => [...row]);
        for (let y = area!.y; y < area!.y + area!.height; y++)
            for (let x = area!.x; x < area!.x + area!.width; x++) rows[y][x] = 0;
        if (!erase) for (let y = area!.y; y < area!.y + area!.height; y++)
            for (let x = area!.x; x < area!.x + area!.width; x++) rows[y + dy][x + dx] = snapshot[y][x];
        const gridChanged = rows.some((row, y) => row.some((value, x) => value !== snapshot[y][x]));
        if (!changed && !gridChanged) return floor;
        return mode === 'rooms' ? { ...floor, objects, rooms: writeIndexGrid(rows) }
            : { ...floor, tileLayers: floor.tileLayers!.map(l => l === layer ? { ...l, tiles: writeIndexGrid(rows) } : l) };
    });
    return floors.every((floor, i) => floor === b.floors[i]) ? b : { ...b, floors };
}
