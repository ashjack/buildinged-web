import { Building, Room, TileEntry } from '../models/app.models';
import { readIndexGrid, writeIndexGrid } from './tbx-grid';
import { cloneRoomEntry, roomEntryKey } from './room-tile-entries';

export type RoomMaterialKey = 'InteriorWall' | 'InteriorWallTrim' | 'Floor' | 'GrimeFloor' | 'GrimeWall';
export interface RoomDefinitionDraft { originalIndex: number | null; room: Room; materials?: Partial<Record<RoomMaterialKey, TileEntry | null>>; }
export const ROOM_MATERIALS: { key: 'InteriorWall' | 'InteriorWallTrim' | 'Floor' | 'GrimeFloor' | 'GrimeWall'; label: string; category: string }[] = [
    { key: 'InteriorWall', label: 'Interior wall', category: 'interior_walls' },
    { key: 'InteriorWallTrim', label: 'Interior wall trim', category: 'interior_wall_trim' },
    { key: 'Floor', label: 'Floor', category: 'floors' },
    { key: 'GrimeFloor', label: 'Grime – floors', category: 'grime_floor' },
    { key: 'GrimeWall', label: 'Grime – walls', category: 'grime_wall' },
];

/** RoomsDialog::pickColorForNewRoom uses the first unused color in this order. */
export function unusedRoomColor(rooms: Room[]): string {
    return ['200 200 200', '128 128 128', '255 0 0', '0 255 0', '0 0 255', '0 255 255', '255 255 0', '255 200 0', '255 150 0', '255 110 0']
        .find(color => !rooms.some(room => room.Color === color)) || '255 255 255';
}

export function newRoomDefinition(building: Building, rooms: Room[]): Room {
    let n = 1;
    while (rooms.some(room => room.InternalName === `room${n}`)) n++;
    const tile = (category: string) => building.entries.findIndex(entry => entry.category === category) + 1;
    return { Name: `Room ${n}`, InternalName: `room${n}`, Color: unusedRoomColor(rooms),
        InteriorWall: tile('interior_walls'), InteriorWallTrim: tile('interior_wall_trim'), Floor: tile('floors'), GrimeFloor: 0, GrimeWall: 0 };
}

/** Reindex membership by original identity, not name: names may be duplicated or edited. */
export function editRoomDefinitions(building: Building, originalRooms: Room[], drafts: RoomDefinitionDraft[]): Building {
    if (building.rooms !== originalRooms) return building;
    let entries = building.entries;
    drafts = drafts.map(draft => {
        const room = { ...draft.room };
        for (const field of ROOM_MATERIALS) {
            if (!draft.materials || !(field.key in draft.materials)) continue;
            const entry = draft.materials[field.key];
            if (!entry) { room[field.key] = 0; continue; }
            if (entry.category !== field.category) { room[field.key] = -1; continue; }
            const key = roomEntryKey(entry);
            let index = entries.findIndex(e => roomEntryKey(e) === key);
            if (index < 0) { index = entries.length; entries = [...entries, cloneRoomEntry(entry)]; }
            room[field.key] = index + 1;
        }
        return { ...draft, room };
    });
    const seen = new Set<number>();
    for (const draft of drafts) {
        if (draft.originalIndex !== null) {
            if (!Number.isInteger(draft.originalIndex) || !originalRooms[draft.originalIndex] || seen.has(draft.originalIndex)) return building;
            seen.add(draft.originalIndex);
        }
        if (!draft.room.Name.trim() || !draft.room.InternalName.trim() || !/^\d{1,3} \d{1,3} \d{1,3}$/.test(draft.room.Color)
            || draft.room.Color.split(' ').some(channel => Number(channel) > 255)) return building;
        if (ROOM_MATERIALS.some(field => {
            const id = draft.room[field.key];
            return !Number.isInteger(id) || id < 0 || id > entries.length;
        })) return building;
    }
    const rooms = drafts.map(draft => ({ ...draft.room }));
    if (drafts.length === originalRooms.length && drafts.every((draft, index) => draft.originalIndex === index
        && JSON.stringify(draft.room) === JSON.stringify(originalRooms[index]))) return building;
    const indices = new Map(drafts.filter(d => d.originalIndex !== null).map((draft) => [draft.originalIndex! + 1, drafts.indexOf(draft) + 1]));
    const floors = building.floors.map(floor => {
        let changed = false;
        const grid = readIndexGrid(floor.rooms, building.width, building.height).map(row => row.map(index => {
            const next = indices.get(index) || 0;
            if (next !== index) changed = true;
            return next;
        }));
        return changed ? { ...floor, rooms: writeIndexGrid(grid) } : floor;
    });
    return { ...building, entries, rooms, floors };
}
