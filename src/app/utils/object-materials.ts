import { Building, TileEntry } from '../models/app.models';
import { cloneRoomEntry, roomEntryKey } from './room-tile-entries';

export type BuildingMaterialField = 'Door' | 'DoorFrame' | 'Window' | 'Curtains' | 'Shutters' | 'Stairs' | 'RoofCap' | 'RoofSlope' | 'RoofTop';
export const BUILDING_MATERIAL_CATEGORIES: Record<BuildingMaterialField, string> = {
    Door: 'doors', DoorFrame: 'door_frames', Window: 'windows', Curtains: 'curtains', Shutters: 'shutters', Stairs: 'stairs',
    RoofCap: 'roof_caps', RoofSlope: 'roof_slopes', RoofTop: 'roof_tops'
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
    const id = resolved.object[field];
    const objectField = field === 'RoofCap' ? 'CapTiles' : field === 'RoofSlope' ? 'SlopeTiles' : undefined;
    // CategoryDock changes caps and slopes on every roof. Tops remain per object.
    let changed = false;
    const floors = objectField ? building.floors.map(floor => {
        if (!floor.objects.some(object => object.type === 'roof' && object[objectField] !== id)) return floor;
        changed = true;
        return { ...floor, objects: floor.objects.map(object => object.type === 'roof' ? { ...object, [objectField]: id } : object) };
    }) : building.floors;
    if (!changed && building[field] === id && resolved.building === building) return building;
    return { ...resolved.building, [field]: id, floors };
}
