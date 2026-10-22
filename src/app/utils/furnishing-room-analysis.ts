import { Building, Point, Room } from '../models/app.models';
import { FurnishingAnalysis, FurnishingCatalog, FurnishingEdge, FurnishingObstacle, FurnishingRoomType, PhysicalRoom } from '../models/auto-furnishing.models';
import { generateBuildingSquares, resolveFurniture } from '../services/native-squares';
import { readIndexGrid } from './tbx-grid';
import { furnitureVariantKey } from './furnishing-catalog';

export const furnishingCellKey = (p: Point) => `${p.x}:${p.y}`;
const edgeKey = (edge: FurnishingEdge) => `${edge.level}:${edge.x}:${edge.y}:${edge.axis}`;
const atLevel = (level: number, p: Point) => `${level}:${furnishingCellKey(p)}`;
const sorted = (cells: Point[]) => cells.sort((a, b) => a.y - b.y || a.x - b.x);
const directions = [{ x: 0, y: -1, side: 'N' }, { x: 1, y: 0, side: 'E' }, { x: 0, y: 1, side: 'S' }, { x: -1, y: 0, side: 'W' }] as const;
export function suggestFurnishingRoomType(room: Room): FurnishingRoomType {
    const aliases: Record<string, FurnishingRoomType> = { bedroom: 'bedroom', bathroom: 'bathroom', kitchen: 'kitchen', livingroom: 'livingroom',
        diningroom: 'diningroom', hall: 'hall', hallway: 'hall', foyer: 'hall', office: 'office' };
    const normalize = (name: string) => name.split('#')[0].toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[0-9]+$/, '');
    return aliases[normalize(room.InternalName)] || aliases[normalize(room.Name)] || 'unknown';
}
/** Document-only preparation: no scene caches, view preferences, randomness, edits or placement. */
export function analyzeFurnishingRooms(building: Building, catalog?: FurnishingCatalog): FurnishingAnalysis {
    const projection = generateBuildingSquares(building, true);
    const edges = projection.edges!, edgeMap = new Map(edges.map(edge => [edgeKey(edge), edge]));
    const result: FurnishingAnalysis = { rooms: [], edges, obstacles: [], diagnostics: [] };
    const grids = building.floors.map(floor => readIndexGrid(floor.rooms, building.width, building.height));
    const surfaces = new Set(projection.tiles.filter(tile => tile.layer === 'Floor').map(tile => atLevel(tile.level, tile)));
    const owners = new Map<string, PhysicalRoom>();
    const within = (p: Point) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < building.width && p.y < building.height;
    const outsideRoom = (index: number) => !building.rooms[index - 1] || building.rooms[index - 1].Name.split('#')[0].toLowerCase() === 'emptyoutside';
    const edgeAt = (level: number, p: Point, direction: typeof directions[number]) => edgeMap.get(`${level}:${p.x + (direction.side === 'E' ? 1 : 0)}:${p.y + (direction.side === 'S' ? 1 : 0)}:${direction.side === 'W' || direction.side === 'E' ? 'W' : 'N'}`)!;
    grids.forEach((grid, level) => {
        for (let y = 0; y < building.height; y++) for (let x = 0; x < building.width; x++) {
            const index = grid[y][x], origin = { x, y };
            if (!index || outsideRoom(index) || owners.has(atLevel(level, origin))) continue;
            const definition = building.rooms[index - 1];
            const room: PhysicalRoom = { id: `floor:${level}/room:${index}/cell:${x},${y}`, level, roomIndex: index - 1, name: definition.Name,
                suggestedType: suggestFurnishingRoomType(definition), needsReview: false, cells: [], bounds: { x, y, width: 1, height: 1 }, boundaries: [], entrances: [], windowEdges: [],
                obstacles: [], reservedCells: [], blockedCells: [], availableCells: [] };
            const queue = [origin]; owners.set(atLevel(level, origin), room);
            for (let i = 0; i < queue.length; i++) {
                const point = queue[i]; room.cells.push(point);
                for (const direction of directions) {
                    const next = { x: point.x + direction.x, y: point.y + direction.y }, edge = edgeAt(level, point, direction);
                    if (!within(next) || grid[next.y][next.x] !== index || owners.has(atLevel(level, next)) || edge.wall || edge.opening) continue;
                    owners.set(atLevel(level, next), room); queue.push(next);
                }
            }
            sorted(room.cells);
            const limits = room.cells.reduce((bounds, cell) => ({ left: Math.min(bounds.left, cell.x), right: Math.max(bounds.right, cell.x),
                top: Math.min(bounds.top, cell.y), bottom: Math.max(bounds.bottom, cell.y) }), { left: x, right: x, top: y, bottom: y });
            room.bounds = { x: limits.left, y: limits.top, width: limits.right - limits.left + 1, height: limits.bottom - limits.top + 1 };
            result.rooms.push(room);
            if (room.suggestedType === 'unknown') result.diagnostics.push({ code: 'unknown-room-type', roomId: room.id, level, preventsPlanning: true, message: `Choose a furnishing type for '${room.name}'.` });
        }
    });
    const addObstacle = (obstacle: FurnishingObstacle) => {
        obstacle.cells = sorted(obstacle.cells.filter(within));
        if (obstacle.cells.length) result.obstacles.push(obstacle);
    };
    const variants = new Map((catalog?.items || []).flatMap(item => item.variants.map(variant => {
        const entry = item.definition.entries.find(entry => entry.orient === variant.orient)!;
        return [furnitureVariantKey(entry, item.definition.layer), { item, variant }] as const;
    })));
    building.floors.forEach((floor, level) => {
        for (const object of floor.objects) {
            const origin = { x: Number(object.x), y: Number(object.y) };
            if (!Number.isInteger(origin.x) || !Number.isInteger(origin.y)) {
                result.diagnostics.push({ code: 'invalid-object', level, uid: object.uid, preventsPlanning: true, message: 'An object has invalid coordinates.' }); continue;
            }
            if (object.type === 'stairs') {
                const vertical = object.dir === 'N';
                const cells = Array.from({ length: 5 }, (_, i) => ({ x: origin.x + (vertical ? 0 : i), y: origin.y + (vertical ? i : 0) }));
                if (!['W', 'N'].includes(object.dir) || !cells.every(within)) {
                    for (const affected of [level, level + 1].filter(index => !!building.floors[index])) {
                        result.diagnostics.push({ code: 'invalid-stairs', level: affected, uid: object.uid, preventsPlanning: true, message: 'Stairs do not have a valid five-cell footprint.' });
                    }
                    continue;
                }
                // The tread/landing zone is reserved for furniture, not treated as an impassable wall.
                addObstacle({ kind: 'stairs', level, uid: object.uid, cells, blocksMovement: false });
                if (building.floors[level + 1]) addObstacle({ kind: 'stair-landing', level: level + 1, uid: object.uid, cells, blocksMovement: false });
            } else if (object.type === 'furniture') {
                const resolved = resolveFurniture(building, object);
                if (!resolved) {
                    addObstacle({ kind: 'unknown-furniture', level, uid: object.uid, cells: [origin], blocksMovement: true });
                    result.diagnostics.push({ code: 'unresolved-furniture', level, uid: object.uid, preventsPlanning: true, message: 'Furniture has no usable definition; its full footprint is unknown.' }); continue;
                }
                const known = variants.get(furnitureVariantKey(resolved.definition, resolved.layer));
                const shift = (cells: Point[]) => cells.map(cell => ({ x: origin.x + cell.x, y: origin.y + cell.y }));
                if (known) {
                    addObstacle({ kind: 'furniture', level, uid: object.uid, catalogId: known.item.id,
                        cells: shift(known.variant.footprint), blocksMovement: !!known.variant.blockedCells.length,
                        accessCells: shift(known.variant.accessCells).filter(within), surfaceCells: shift(known.variant.surfaceCells).filter(within) });
                } else {
                    const cells: Point[] = [];
                    for (let y = 0; y < resolved.height; y++) for (let x = 0; x < resolved.width; x++) cells.push({ x: origin.x + x, y: origin.y + y });
                    addObstacle({ kind: 'unknown-furniture', level, uid: object.uid, cells, blocksMovement: true });
                    result.diagnostics.push({ code: 'unclassified-furniture', level, uid: object.uid, message: 'Unclassified furniture is conservatively reserved using its full bounds.' });
                }
            } else if (!['roof', 'wall', 'door', 'window'].includes(object.type)) {
                addObstacle({ kind: 'unknown-object', level, uid: object.uid, cells: [origin], blocksMovement: true });
                result.diagnostics.push({ code: 'unknown-object', level, uid: object.uid, preventsPlanning: true, message: 'Object type is not supported by furnishing analysis.' });
            }
        }
        for (const layer of floor.tileLayers || []) {
            const grid = readIndexGrid(layer.tiles, building.width + 1, building.height + 1), cells: Point[] = [];
            grid.forEach((row, y) => row.forEach((index, x) => {
                const name = building.user_tiles[index - 1]?.tile;
                if (!index || !name || name === 'None') return;
                if (layer.layer === 'Floor' && within({ x, y })) surfaces.add(atLevel(level, { x, y }));
                else if (/^(Walls|Doors|Windows|Frames)/.test(layer.layer)) {
                    // Border wall tiles live on the extra row/column, beside the last interior cell.
                    cells.push({ x: Math.min(x, building.width - 1), y: Math.min(y, building.height - 1) });
                } else if (/^(Furniture|FloorFurniture|WallFurniture)/.test(layer.layer) && within({ x, y })) cells.push({ x, y });
            }));
            if (cells.length) {
                addObstacle({ kind: 'manual-tile', level, cells, blocksMovement: true });
                result.diagnostics.push({ code: 'manual-tile-semantics', level, preventsPlanning: /^(Walls|Doors|Windows|Frames)/.test(layer.layer),
                    message: `Manual ${layer.layer} tiles are reserved; their collision and opening semantics are unknown.` });
            }
        }
    });
    for (const room of result.rooms) {
        const boundaries = new Map<string, FurnishingEdge>();
        for (const point of room.cells) for (const direction of directions) {
            const edge = edgeAt(room.level, point, direction), next = { x: point.x + direction.x, y: point.y + direction.y };
            const neighbour = owners.get(atLevel(room.level, next));
            if (neighbour === room && !edge.wall && !edge.opening) continue;
            boundaries.set(edgeKey(edge), edge);
            if (neighbour !== room && (edge.opening?.kind === 'door' || !edge.wall && !edge.opening)) {
                room.entrances.push({ edge, kind: edge.opening ? 'door' : 'open', inside: point, outside: next,
                    ...(neighbour ? { targetRoomId: neighbour.id } : {}), exterior: !neighbour });
            }
        }
        room.boundaries = [...boundaries.values()]; room.windowEdges = room.boundaries.filter(edge => edge.opening?.kind === 'window');
        const missing = room.cells.filter(cell => !surfaces.has(atLevel(room.level, cell)));
        if (missing.length) {
            const obstacle: FurnishingObstacle = { kind: 'missing-floor', level: room.level, cells: missing, blocksMovement: true };
            result.obstacles.push(obstacle);
            result.diagnostics.push({ code: 'missing-floor', roomId: room.id, level: room.level, message: `${missing.length} room cells have no floor surface, including any stair openings.` });
        }
        if (!room.entrances.length) result.diagnostics.push({ code: 'no-entrance', roomId: room.id, level: room.level, preventsPlanning: true, message: 'No doorway or open entrance was found.' });
    }
    for (const room of result.rooms) {
        const membership = new Set(room.cells.map(furnishingCellKey)), blocked = new Map<string, Point>(), reserved = new Map<string, Point>();
        const reserve = (cells: Point[], map: Map<string, Point>) => cells.forEach(cell => { const key = furnishingCellKey(cell); if (membership.has(key)) map.set(key, cell); });
        for (const obstacle of result.obstacles.filter(obstacle => obstacle.level === room.level)) {
            const cells = obstacle.cells.filter(cell => membership.has(furnishingCellKey(cell)));
            const access = (obstacle.accessCells || []).filter(cell => membership.has(furnishingCellKey(cell)));
            if (!cells.length && !access.length) continue;
            room.obstacles.push({ ...obstacle, cells });
            if (obstacle.blocksMovement) reserve(cells, blocked);
            if (obstacle.blocksMovement || obstacle.kind !== 'furniture') reserve(cells, reserved);
            reserve(access, reserved);
        }
        reserve(room.entrances.map(entrance => entrance.inside), reserved);
        room.blockedCells = sorted([...blocked.values()]); room.reservedCells = sorted([...reserved.values()]);
        room.availableCells = room.cells.filter(cell => !reserved.has(furnishingCellKey(cell)));
        room.needsReview = result.diagnostics.some(diagnostic => diagnostic.preventsPlanning &&
            (diagnostic.roomId ? diagnostic.roomId === room.id : diagnostic.level === room.level));
    }
    return result;
}
