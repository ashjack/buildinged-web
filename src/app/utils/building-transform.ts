import { Building } from '../models/app.models';
import { resolveFurniture } from '../services/native-squares';
import { emptyIndexGrid, gridContains, readIndexGrid, writeIndexGrid } from './tbx-grid';

export type BuildingTransform = 'rotate-left' | 'rotate-right' | 'flip-horizontal' | 'flip-vertical';
export const BUILDING_TRANSFORM_LABELS: Record<BuildingTransform, string> = {
    'rotate-left': 'Rotate left', 'rotate-right': 'Rotate right',
    'flip-horizontal': 'Flip horizontal', 'flip-vertical': 'Flip vertical',
};

/** BuildingObject/FurnitureObject/RoofObject use different coordinate systems. */
export function transformBuilding(building: Building, operation: BuildingTransform): Building {
    const rotation = operation.startsWith('rotate'), right = operation === 'rotate-right';
    const horizontal = operation === 'flip-horizontal';
    const { width: w, height: h } = building;
    const width = rotation ? h : w, height = rotation ? w : h;
    const cell = (x: number, y: number): [number, number] => rotation
        ? right ? [h - y - 1, x] : [y, w - x - 1]
        : horizontal ? [w - x - 1, y] : [x, h - y - 1];
    const directions: Record<string, string> = rotation
        ? right ? { W: 'N', N: 'E', E: 'S', S: 'W', SW: 'NW', NW: 'NE', NE: 'SE', SE: 'SW' }
            : { W: 'S', S: 'E', E: 'N', N: 'W', SW: 'SE', SE: 'NE', NE: 'NW', NW: 'SW' }
        : horizontal ? { W: 'E', E: 'W', N: 'N', S: 'S', SW: 'SE', SE: 'SW', NW: 'NE', NE: 'NW' }
            : { W: 'W', E: 'E', N: 'S', S: 'N', SW: 'NW', NW: 'SW', SE: 'NE', NE: 'SE' };
    const grid = (text: string, border: number, level: number, layer: string): string => {
        const target = emptyIndexGrid(width + border, height + border);
        readIndexGrid(text, w + border, h + border).forEach((row, y) => row.forEach((value, x) => {
            if (!value) return;
            const [tx, ty] = cell(x, y);
            // TransformBuildingContents::prepare maps painted cells, including the extra border.
            if (!gridContains(width + border, height + border, tx, ty)) {
                throw new Error(`A painted tile on level ${level}, layer ${layer} at ${x},${y} would move outside the building. Move it inward or enlarge the area before transforming. No changes were made.`);
            }
            target[ty][tx] = value;
        }));
        return writeIndexGrid(target);
    };
    const object = (source: any): any => {
        const o = { ...source }, x = Number(o.x), y = Number(o.y);
        if (o.type === 'furniture') {
            const before = resolveFurniture(building, o);
            o.orient = directions[o.orient];
            const after = resolveFurniture(building, o);
            // Empty corner orientations have a zero-sized resolved tile in C++.
            const oldWidth = before?.width ?? 0, oldHeight = before?.height ?? 0;
            const newWidth = after?.width ?? 0, newHeight = after?.height ?? 0;
            [o.x, o.y] = rotation ? right ? [h - y - newWidth, x] : [y, w - x - oldWidth]
                : horizontal ? [w - x - Math.max(oldWidth, newWidth), y] : [x, h - y - Math.max(oldHeight, newHeight)];
        } else if (o.type === 'roof') {
            const ow = Number(o.width), oh = Number(o.height);
            [o.x, o.y] = rotation ? right ? [h - y - oh, x] : [y, w - x - ow]
                : horizontal ? [w - x - ow, y] : [x, h - y - oh];
            if (rotation) { o.width = oh; o.height = ow; }
            const type = String(o.RoofType);
            const match = /^(Slope|Dormer|ShallowSlope|Slope30|Dormer30|CornerInner|CornerOuter|CornerSlope30Inner|CornerSlope30Outer)(SW|NW|NE|SE|W|N|E|S)$/.exec(type);
            // Native flip() leaves CornerSlope30 types unchanged (unlike rotate()).
            if (match && (rotation || !match[1].startsWith('CornerSlope30'))) o.RoofType = match[1] + directions[match[2]];
            else if (rotation && /^(ShallowPeak|Peak30|Peak)(WE|NS)$/.test(type))
                o.RoofType = type.replace(/WE$|NS$/, suffix => suffix === 'WE' ? 'NS' : 'WE');
            for (const side of ['W', 'N', 'E', 'S']) {
                const destination = directions[side];
                if (source['capped' + side] === undefined) delete o['capped' + destination];
                else o['capped' + destination] = source['capped' + side];
            }
        } else if (o.type === 'wall') {
            const length = Number(o.length), north = o.dir === 'N';
            [o.x, o.y] = rotation ? right ? [h - y - (north ? length : 0), x] : [y, w - x - (north ? 0 : length)]
                : horizontal ? [w - x - (north ? 0 : length), y] : [x, h - y - (north ? length : 0)];
            if (rotation) o.dir = north ? 'W' : 'N';
        } else if (['door', 'window', 'stairs'].includes(o.type)) {
            if (rotation) o.dir = o.dir === 'N' ? 'W' : 'N';
            [o.x, o.y] = cell(x, y);
            if (rotation ? right && o.dir === 'W' : horizontal && o.dir === 'W') o.x++;
            if (rotation ? !right && o.dir === 'N' : !horizontal && o.dir === 'N') o.y++;
            if (o.type === 'stairs') {
                if (o.dir === 'W' && (rotation ? right : horizontal)) o.x -= 5;
                if (o.dir === 'N' && (rotation ? !right : !horizontal)) o.y -= 5;
            }
        } else throw new Error(`Cannot transform unsupported object type '${o.type}'. No changes were made.`);
        return o;
    };
    return { ...building, width, height, floors: building.floors.map((floor, level) => ({
        ...floor, rooms: grid(floor.rooms, 0, level, 'Rooms'), objects: floor.objects.map(object),
        tileLayers: floor.tileLayers?.map(layer => ({ ...layer, tiles: grid(layer.tiles, 1, level, layer.layer) })),
    })) };
}
