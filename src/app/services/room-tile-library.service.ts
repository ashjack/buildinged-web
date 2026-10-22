import { Injectable } from '@angular/core';
import { TileEntry } from '../models/app.models';
import { cloneRoomEntry, ROOM_TILE_ENUMS, roomEntryKey } from '../utils/room-tile-entries';
import { BuildingService } from './building.service';

const STORAGE_KEY = 'buildinged.roomTileLibrary.v1';
@Injectable({ providedIn: 'root' })
export class RoomTileLibraryService {
    constructor(private buildings: BuildingService) { }
    async load(): Promise<TileEntry[]> {
        const base = await this.buildings.getDefaultTileEntries();
        let saved: { entries?: TileEntry[]; hidden?: string[] } = {};
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* Keep bundled defaults if preferences are invalid. */ }
        const hidden = new Set(Array.isArray(saved?.hidden) ? saved.hidden : []);
        const custom = Array.isArray(saved?.entries) ? saved.entries.filter(entry => this.valid(entry)) : [];
        const entries = [...base.filter(entry => ROOM_TILE_ENUMS[entry.category] && !hidden.has(roomEntryKey(entry))), ...custom];
        // Expert mode permits duplicate and blank entries; preserve their separate rows.
        return entries.map(cloneRoomEntry);
    }
    async save(entries: TileEntry[]): Promise<void> {
        if (!entries.every(entry => this.valid(entry))) throw new Error('Each tile entry needs valid variant names and integer offsets.');
        const base = (await this.buildings.getDefaultTileEntries()).filter(entry => ROOM_TILE_ENUMS[entry.category]);
        // Store the complete chosen order; hide the seed entries so reordering is preserved too.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: entries.map(cloneRoomEntry), hidden: base.map(roomEntryKey) }));
    }
    valid(entry: TileEntry): boolean {
        return !!entry && Array.isArray(ROOM_TILE_ENUMS[entry.category]) && Array.isArray(entry.tiles) && entry.tiles.length > 0
            && entry.tiles.every(tile =>
                typeof tile?.tile === 'string' && (!tile.tile || /^[\w&+(). -]+$/.test(tile.tile)) && ROOM_TILE_ENUMS[entry.category].includes(tile.enum || '')
                && (!tile.offset || /^-?\d+\s+-?\d+$/.test(tile.offset)))
            && new Set(entry.tiles.map(tile => tile.enum)).size === entry.tiles.length;
    }
}
