import { Building, TileEntry } from '../models/app.models';
import { cloneRoomEntry, roomEntryKey } from './room-tile-entries';

export type BuildingMaterialField = 'Door' | 'DoorFrame' | 'Window' | 'Curtains' | 'Shutters' | 'Stairs';
export const BUILDING_MATERIAL_CATEGORIES: Record<BuildingMaterialField, string> = {
    Door: 'doors', DoorFrame: 'door_frames', Window: 'windows', Curtains: 'curtains', Shutters: 'shutters', Stairs: 'stairs'
};
/** Register complete definitions atomically with the edit that references them. */
export function resolveObjectMaterials(building: Building, object: any, materials: Record<string, TileEntry | null> = {}) {
    let entries = building.entries;
    const result = { ...object };
    for (const [field, entry] of Object.entries(materials)) {
        if (!entry) { result[field] = 0; continue; }
        const key = roomEntryKey(entry);
        let index = entries.findIndex(value => roomEntryKey(value) === key);
        if (index < 0) { index = entries.length; entries = [...entries, cloneRoomEntry(entry)]; }
        result[field] = index + 1;
    }
    return { building: entries === building.entries ? building : { ...building, entries }, object: result };
}
export function setBuildingMaterial(building: Building, field: BuildingMaterialField, entry: TileEntry | null): Building {
    if (!(field in BUILDING_MATERIAL_CATEGORIES) || (entry && entry.category !== BUILDING_MATERIAL_CATEGORIES[field])) return building;
    const resolved = resolveObjectMaterials(building, building, { [field]: entry });
    if (building[field] === resolved.object[field] && resolved.building === building) return building;
    return { ...resolved.building, [field]: resolved.object[field] };
}
