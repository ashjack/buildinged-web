import { Building, TileArea } from '../models/app.models';
import { emptyIndexGrid, readIndexGrid, writeIndexGrid } from './tbx-grid';

function clippedArea(area: TileArea, width: number, height: number): TileArea | undefined {
    if (![area.x, area.y, area.width, area.height].every(Number.isSafeInteger) || area.width < 1 || area.height < 1) return undefined;
    const x = Math.max(0, area.x), y = Math.max(0, area.y);
    const right = Math.min(width, area.x + area.width), bottom = Math.min(height, area.y + area.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

function paint(rows: number[][], area: TileArea, value: number): boolean {
    let changed = false;
    for (let y = area.y; y < area.y + area.height; y++) {
        for (let x = area.x; x < area.x + area.width; x++) {
            if (rows[y][x] !== value) { rows[y][x] = value; changed = true; }
        }
    }
    return changed;
}

export function editRooms(building: Building, level: number, requested: TileArea, room: number): Building {
    const area = clippedArea(requested, building.width, building.height);
    if (!area || !building.floors[level] || !Number.isInteger(room) || room < 0 || room > building.rooms.length) return building;
    const floor = building.floors[level];
    const rows = readIndexGrid(floor.rooms, building.width, building.height);
    if (!paint(rows, area, room)) return building;
    return { ...building, floors: building.floors.map((value, index) => index === level ? { ...floor, rooms: writeIndexGrid(rows) } : value) };
}

export function editTiles(building: Building, level: number, requested: TileArea, layer: string, tile: string | null): Building {
    const area = clippedArea(requested, building.width + 1, building.height + 1);
    if (!area || !building.floors[level] || !layer || (tile !== null && !tile)) return building;
    const floor = building.floors[level], layers = floor.tileLayers || [];
    const previous = layers.find(value => value.layer === layer);
    if (!previous && tile === null) return building;
    const name = tile?.replace(/\.png$/, '');
    const existing = name === undefined ? -1 : building.user_tiles.findIndex(value => value.tile === name);
    const userTiles = tile !== null && existing < 0 ? [...building.user_tiles, { tile: name! }] : building.user_tiles;
    const index = tile === null ? 0 : existing < 0 ? userTiles.length : existing + 1;
    const rows = previous ? readIndexGrid(previous.tiles, building.width + 1, building.height + 1) : emptyIndexGrid(building.width + 1, building.height + 1);
    if (!paint(rows, area, index)) return building;
    const updated = { layer, tiles: writeIndexGrid(rows) };
    return {
        ...building, user_tiles: userTiles,
        floors: building.floors.map((value, floorIndex) => floorIndex === level ? {
            ...floor, tileLayers: previous ? layers.map(value => value === previous ? updated : value) : [...layers, updated],
        } : value),
    };
}
