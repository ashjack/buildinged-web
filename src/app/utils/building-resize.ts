import { Building, TileArea } from '../models/app.models';
import { objectBounds } from './selection-edits';
import { emptyIndexGrid, gridContains, readIndexGrid, writeIndexGrid } from './tbx-grid';

export const MAX_BUILDING_DIMENSION = 256;
export interface BuildingResize { width: number; height: number; offsetX: number; offsetY: number; }

export function validBuildingResize(edit: BuildingResize): boolean {
    return [edit.width, edit.height, edit.offsetX, edit.offsetY].every(Number.isSafeInteger) && edit.width >= 1 && edit.height >= 1
        && edit.width <= MAX_BUILDING_DIMENSION && edit.height <= MAX_BUILDING_DIMENSION;
}

/** ResizeBuilding/ResizeFloor: shift every floor, keeping the extra manual-tile border. */
export function resizeBuilding(building: Building, edit: BuildingResize): Building {
    if (!validBuildingResize(edit)) return building;
    const { width, height, offsetX, offsetY } = edit;
    if (offsetX < Math.min(0, width - building.width) || offsetX > Math.max(0, width - building.width)
        || offsetY < Math.min(0, height - building.height) || offsetY > Math.max(0, height - building.height)) return building;
    if (building.width === width && building.height === height && !offsetX && !offsetY) return building;
    const moveGrid = (text: string, border: number): string => {
        const source = readIndexGrid(text, building.width + border, building.height + border);
        const target = emptyIndexGrid(width + border, height + border);
        source.forEach((row, y) => row.forEach((value, x) => {
            if (gridContains(width + border, height + border, x + offsetX, y + offsetY))
                target[y + offsetY][x + offsetX] = value;
        }));
        return writeIndexGrid(target);
    };
    return { ...building, width, height, floors: building.floors.map(floor => ({
        ...floor, rooms: moveGrid(floor.rooms, 0),
        tileLayers: floor.tileLayers?.map(layer => ({ ...layer, tiles: moveGrid(layer.tiles, 1) })),
        objects: floor.objects.flatMap(object => {
            const moved = { ...object, x: Number(object.x) + offsetX, y: Number(object.y) + offsetY };
            const bounds = objectBounds(building, moved);
            // Native roofs, stairs and furniture must fit entirely inside the area.
            // Doors/windows and the facing edge of a wall may use the boundary line.
            const inside = ['roof', 'stairs', 'furniture'].includes(object.type);
            const maxX = width + (inside || object.type === 'wall' && object.dir !== 'N' ? 0 : 1);
            const maxY = height + (inside || object.type === 'wall' && object.dir === 'N' ? 0 : 1);
            return Object.values(bounds).every(Number.isSafeInteger) && bounds.width > 0 && bounds.height > 0
                && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= maxX && bounds.y + bounds.height <= maxY ? [moved] : [];
        }),
    })) };
}

function union(a: TileArea | undefined, b: TileArea | undefined): TileArea | undefined {
    if (!b || b.width <= 0 || b.height <= 0) return a;
    if (!a || a.width <= 0 || a.height <= 0) return { ...b };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function clip(area: TileArea, building: Building): TileArea | undefined {
    const x = Math.max(0, area.x), y = Math.max(0, area.y);
    const width = Math.min(building.width, area.x + area.width) - x;
    const height = Math.min(building.height, area.y + area.height) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/** BuildingEditorWindow::cropToMinimum, including its wall and tile boundary rules. */
export function minimumBuildingBounds(building: Building): TileArea | undefined {
    let bounds: TileArea | undefined, tiles: TileArea | undefined;
    let horizontal: TileArea | undefined, vertical: TileArea | undefined;
    for (const floor of building.floors) {
        readIndexGrid(floor.rooms, building.width, building.height).forEach((row, y) => row.forEach((value, x) => {
            if (value) bounds = union(bounds, { x, y, width: 1, height: 1 });
        }));
        for (const object of floor.objects) {
            const area = objectBounds(building, object);
            if (object.type === 'door' || object.type === 'window' || object.type === 'wall') {
                const isHorizontal = object.type === 'wall' ? object.dir !== 'N' : object.dir === 'N';
                if (isHorizontal) horizontal = union(horizontal, area);
                else vertical = union(vertical, area);
            } else bounds = union(bounds, clip(area, building));
        }
        for (const layer of floor.tileLayers || []) {
            readIndexGrid(layer.tiles, building.width + 1, building.height + 1).forEach((row, y) => row.forEach((value, x) => {
                if (value) tiles = union(tiles, { x, y, width: 1, height: 1 });
            }));
        }
    }
    if (tiles) {
        if (tiles.width > 1) tiles.width--;
        if (tiles.height > 1) tiles.height--;
        bounds = union(bounds, tiles);
    }
    const bottom = (r: TileArea | undefined) => r ? r.y + r.height - 1 : -1;
    const right = (r: TileArea | undefined) => r ? r.x + r.width - 1 : -1;
    if (horizontal && bottom(horizontal) > bottom(union(bounds, vertical))) horizontal.height--;
    if (vertical && right(vertical) > right(union(bounds, horizontal))) vertical.width--;
    bounds = union(bounds, union(horizontal, vertical));
    return bounds && clip(bounds, building);
}

export function cropBuildingToMinimum(building: Building): Building {
    const bounds = minimumBuildingBounds(building);
    return bounds ? resizeBuilding(building, { width: bounds.width, height: bounds.height, offsetX: -bounds.x, offsetY: -bounds.y }) : building;
}
