import { TileEntry } from '../models/app.models';

const wall = ['West', 'North', 'NorthWest', 'SouthEast', 'WestWindow', 'NorthWindow', 'WestDoor', 'NorthDoor'];
export const ROOM_TILE_ENUMS: Record<string, string[]> = {
    interior_walls: wall, interior_wall_trim: wall, floors: ['Floor'],
    grime_floor: ['West', 'North', 'East', 'South', 'SouthWest', 'NorthWest', 'NorthEast', 'SouthEast'],
    grime_wall: [...wall, 'WestTrim', 'NorthTrim', 'NorthWestTrim', 'SouthEastTrim', 'WestDoubleLeft', 'WestDoubleRight', 'NorthDoubleLeft', 'NorthDoubleRight'],
};
/** BTC_*::createEntryFromSingleTile, including the native eight-column sheet offsets. */
export function roomEntryFromTile(category: string, tile: string): TileEntry {
    const name = tile.replace(/\.png$/i, ''), match = /^(.*)_(\d+)$/.exec(name);
    if (!match || !ROOM_TILE_ENUMS[category]) throw new Error('Select a numbered tileset sprite.');
    const offsets = category === 'floors' ? [0] : category === 'grime_floor' ? [0, 1, 9, 8, 11, 2, 3, 10] : [0, 1, 2, 3, 8, 9, 10, 11];
    return { category, tiles: ROOM_TILE_ENUMS[category].map((value, i) => ({ enum: value,
        tile: i < offsets.length ? `${match[1]}_${String(Number(match[2]) + offsets[i]).padStart(3, '0')}` : 'None' })) };
}
export function roomEntryKey(entry: TileEntry): string {
    return JSON.stringify([entry.category, entry.tiles.filter(t => t.tile && t.tile !== 'None').map(t => [t.enum || '', t.tile.replace(/\.png$/i, ''),
        (t.offset || '0 0').trim().split(/\s+/).map(Number)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
export function roomEntryDisplay(entry: TileEntry | null | undefined): string {
    const preferred = entry?.category === 'floors' ? 'Floor' : 'West';
    // BuildingTileEntry::displayTile uses the category's display slot, even if empty.
    return entry?.tiles.find(tile => tile.enum === preferred)?.tile || 'None';
}
export const cloneRoomEntry = (entry: TileEntry): TileEntry => ({ ...entry, tiles: entry.tiles.map(tile => ({ ...tile })) });
