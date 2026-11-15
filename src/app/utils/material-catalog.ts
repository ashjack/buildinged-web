import { Building, TileEntry } from '../models/app.models';
import { buildingTilesCategory } from './building-tiles';
import { cloneRoomEntry, roomEntryKey } from './room-tile-entries';

/** The menu's material identity stays the same when an admin changes its variant slots or opening shapes. */
export function materialIdentity(entry: TileEntry): string | undefined {
    const display = buildingTilesCategory(entry.category)?.display || 'West';
    const populated = entry.tiles.filter(tile => tile.tile && tile.tile !== 'None');
    const tile = populated.find(tile => tile.enum === display) || populated[0];
    if (!tile) return undefined;
    const name = tile.tile.replace(/\.png$/i, '').replace(/_(\d+)$/, (_, index: string) => `_${Number(index)}`);
    return JSON.stringify([entry.category, tile.enum, name]);
}

export function materialResolver(catalog: readonly TileEntry[]): (entry: TileEntry) => TileEntry {
    const byIdentity = new Map<string, TileEntry>();
    for (const entry of catalog) {
        const identity = materialIdentity(entry);
        if (identity) byIdentity.set(identity, entry);
    }
    return entry => {
        const identity = materialIdentity(entry);
        return identity ? byIdentity.get(identity) || entry : entry;
    };
}

/** Replace definitions in place: all building, room and placed-object indices continue to point at the same material. */
export function overrideBuildingMaterials(building: Building, catalog: readonly TileEntry[]): Building {
    const resolve = materialResolver(catalog);
    let changed = false;
    const entries = building.entries.map(entry => {
        const published = resolve(entry);
        if (published === entry || roomEntryKey(published) === roomEntryKey(entry)) return entry;
        changed = true;
        return cloneRoomEntry(published);
    });
    return changed ? { ...building, entries } : building;
}

/** Published materials replace matching template/local rows; genuinely different local materials remain available. */
export function materialMenuEntries(catalog: readonly TileEntry[], local: readonly TileEntry[]): TileEntry[] {
    const resolve = materialResolver(catalog), entries = new Map<string, TileEntry>();
    for (const entry of local) {
        if (resolve(entry) === entry) entries.set(roomEntryKey(entry), entry);
    }
    for (const entry of catalog) {
        if (resolve(entry) === entry) entries.set(roomEntryKey(entry), entry);
    }
    return [...entries.values()];
}
