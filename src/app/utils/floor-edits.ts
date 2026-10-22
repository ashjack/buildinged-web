import { EditFloor } from '../app.actions';
import { Building, Floor } from '../models/app.models';
import { GUID } from './guid';
import { emptyIndexGrid, writeIndexGrid } from './tbx-grid';

export const MAX_BUILDING_FLOORS = 8;

/** BuildingFloorsDialog: insert above, clone with fresh object identities, or reorder whole floors. */
export function editFloor(building: Building, action: EditFloor): { building: Building; level: number } | undefined {
    const { operation, level } = action;
    if (!Number.isInteger(level) || !building.floors[level]) return undefined;
    const floors = [...building.floors];
    let selected = level;
    if (operation === 'add' || operation === 'duplicate') {
        if (floors.length >= MAX_BUILDING_FLOORS) return undefined;
        const floor: Floor = operation === 'add'
            ? { objects: [], rooms: writeIndexGrid(emptyIndexGrid(building.width, building.height)), tileLayers: [] }
            : JSON.parse(JSON.stringify(floors[level]));
        if (operation === 'duplicate') floor.objects = floor.objects.map(object => ({ ...object, uid: GUID.generateGUID() }));
        selected = level + 1;
        floors.splice(selected, 0, floor);
    } else if (operation === 'remove') {
        if (floors.length <= 1) return undefined;
        floors.splice(level, 1);
        selected = Math.max(0, level - 1);
    } else {
        selected = level + (operation === 'up' ? 1 : -1);
        if (selected < 0 || selected >= floors.length) return undefined;
        [floors[level], floors[selected]] = [floors[selected], floors[level]];
    }
    return { building: { ...building, floors }, level: selected };
}
