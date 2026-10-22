import { Building, Furniture } from '../models/app.models';
import { registerFurniture } from './furniture-definition';

export interface FurnishingAddition {
    level: number;
    object: { uid: string; type: 'furniture'; x: number; y: number; orient: string };
    definition: Furniture;
}

/** All-or-nothing document edit. Definitions and objects share the same undo snapshot. */
export function addFurnishingObjects(building: Building, additions: FurnishingAddition[]): Building {
    if (!additions.length) return building;
    const used = new Set(building.floors.flatMap(floor => floor.objects.map(object => object.uid)));
    for (const addition of additions) {
        const object = addition.object, entry = addition.definition.entries.find(entry => entry.orient === object.orient);
        if (!Number.isSafeInteger(addition.level) || !building.floors[addition.level] || !object.uid || used.has(object.uid) ||
            object.type !== 'furniture' || !Number.isSafeInteger(object.x) || !Number.isSafeInteger(object.y) || !entry?.tiles.length ||
            entry.tiles.some(tile => !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y) || object.x + tile.x < 0 ||
                object.y + tile.y < 0 || object.x + tile.x >= building.width || object.y + tile.y >= building.height)) return building;
        used.add(object.uid);
    }
    let furniture = building.furniture;
    const byLevel = new Map<number, any[]>();
    for (const addition of additions) {
        const registered = registerFurniture(furniture, addition.definition); furniture = registered.furniture;
        const objects = byLevel.get(addition.level) || [];
        objects.push({ ...addition.object, FurnitureTiles: registered.index }); byLevel.set(addition.level, objects);
    }
    return { ...building, furniture, floors: building.floors.map((floor, level) => byLevel.has(level)
        ? { ...floor, objects: [...floor.objects, ...byLevel.get(level)!] } : floor) };
}
