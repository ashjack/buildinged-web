import { Building, FurnitureTileEntry, SvgObject, SvgTile, Tile } from '../models/app.models';
import { readIndexGrid } from '../utils/tbx-grid';
import { buildRoofPlacements } from './roof-patterns';
import { FurnishingEdge } from '../models/auto-furnishing.models';

// Pass order and section semantics follow BuildingFloor::LayoutToSquares and Square.
// Coordinates here are document coordinates; viewport floor offsets are applied later.
export const SQUARE_LAYERS = ['Floor', 'FloorGrime', 'FloorGrime2', 'FloorFurniture',
    'Walls', 'WallTrim', 'Walls2', 'WallTrim2', 'RoofCap', 'RoofCap2', 'WallOverlay',
    'WallOverlay2', 'WallGrime', 'WallGrime2', 'WallFurniture', 'WallFurniture2',
    'Frames', 'Doors', 'Windows', 'Curtains', 'Furniture', 'Furniture2', 'Furniture3',
    'Furniture4', 'Curtains2', 'WallFurniture3', 'WallFurniture4', 'WallOverlay3',
    'WallOverlay4', 'Roof', 'Roof2', 'RoofTop'];

interface Piece { entry: number; enum: string; uid?: string; raw?: string; tag?: string; }
interface Wall { entry: number; trim: number; uid?: string; furniture?: FurnitureTileEntry; raw?: string; }
interface Square {
    x: number; y: number; exterior: boolean; room: number; n: Wall; w: Wall;
    orient: string; sections: Record<string, Piece | undefined>; tiles: Record<string, Piece | undefined>;
}
interface ResolvedFurniture { definition: FurnitureTileEntry; layer: string; width: number; height: number; }
export interface GeneratedBuilding { tiles: SvgTile[]; objects: SvgObject[]; edges?: FurnishingEdge[]; }

export function resolveFurniture(building: Building, object: any): ResolvedFurniture | undefined {
    const furniture = building.furniture[Number(object.FurnitureTiles)];
    if (!furniture) return undefined;
    let definition = furniture.entries.find(entry => entry.orient === object.orient && entry.tiles.length);
    if (!definition && ['N', 'E', 'S'].includes(object.orient)) {
        if (object.orient === 'S') definition = furniture.entries.find(entry => entry.orient === 'N' && entry.tiles.length);
        definition ||= furniture.entries.find(entry => entry.orient === 'W');
    }
    if (!definition) return undefined;
    return { definition, layer: furniture.layer || 'Furniture',
        width: Math.max(0, ...definition.tiles.map(tile => tile.x + 1)),
        height: Math.max(0, ...definition.tiles.map(tile => tile.y + 1)) };
}

/** Pure projection: never consults or mutates the scene cache or the document. */
export function generateBuildingSquares(building: Building, includeStructure = false): GeneratedBuilding {
    const result: GeneratedBuilding = { tiles: [], objects: [], ...(includeStructure ? { edges: [] } : {}) };
    const { width, height } = building;
    const validEntry = (entry: number) => !!building.entries[entry - 1];
    // Native import interns matching definitions, so duplicate table rows must
    // also form a single NW wall/trim here rather than two stacked faces.
    const interned = new Map<string, number>();
    const canonical = building.entries.map((entry, index) => {
        const key = JSON.stringify([entry.category, entry.tiles.map(t => [t.enum, t.tile,
            (t.offset || '0 0').trim().split(/\s+/).map(Number)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
        if (!interned.has(key)) interned.set(key, index + 1);
        return interned.get(key)!;
    });
    const reference = (value: unknown) => canonical[Number(value) - 1] || 0;
    const piece = (entry: unknown, name: string, uid?: string): Piece => ({ entry: Number(entry) || 0, enum: name, uid });
    const wall = (entry = 0, trim = 0, uid?: string): Wall => ({ entry: reference(entry), trim: reference(trim), uid });
    const material = (w: Wall) => validEntry(w.entry) ? w.entry : 0;
    const raw = (name: string | undefined, uid: string): Piece => ({ entry: 0, enum: '', raw: name, uid });

    building.floors.forEach((floor, level) => {
        const openings = new Map<string, FurnishingEdge['opening']>();
        const indices = readIndexGrid(floor.rooms, width, height);
        const roomAt = (x: number, y: number) => {
            const index = indices[y]?.[x] || 0;
            return building.rooms[index - 1]?.Name.split('#')[0].toLowerCase() === 'emptyoutside' ? 0 : index;
        };
        const squares: Square[][] = Array.from({ length: height + 1 }, (_, y) =>
            Array.from({ length: width + 1 }, (_, x) => ({ x, y, room: roomAt(x, y),
                exterior: !roomAt(x, y), n: wall(), w: wall(), orient: '', sections: {}, tiles: {} })));
        const at = (x: number, y: number) => squares[y]?.[x];
        const each = (fn: (s: Square) => void) => {
            for (let x = 0; x <= width; x++) for (let y = 0; y <= height; y++) fn(squares[y][x]);
        };
        const occupied = (p?: Piece) => !!p && (p.raw !== undefined ? !!p.raw && p.raw !== 'None' : validEntry(p.entry));
        // Raw furniture uses the first free slot, shifting out the oldest when full.
        const insert = (s: Square | undefined, p: Piece, layers: string[]) => {
            if (!s || p.raw === undefined) return;
            const free = layers.find(layer => !occupied(s.tiles[layer]));
            if (free) s.tiles[free] = p;
            else {
                layers.slice(0, -1).forEach((layer, i) => s.tiles[layer] = s.tiles[layers[i + 1]]);
                s.tiles[layers[layers.length - 1]] = p;
            }
        };
        each(s => {
            const room = building.rooms[s.room - 1];
            const external = () => wall(building.ExteriorWall, level === 0 ? building.ExteriorWallTrim : 0);
            const internal = () => wall(room?.InteriorWall, room?.InteriorWallTrim);
            if (s.x < width) {
                if (s.exterior && roomAt(s.x, s.y - 1)) s.n = external();
                else if (!s.exterior && (s.y === 0 || roomAt(s.x, s.y - 1) !== s.room)) s.n = internal();
            }
            if (s.y < height) {
                if (s.exterior && roomAt(s.x - 1, s.y)) s.w = external();
                else if (!s.exterior && (s.x === 0 || roomAt(s.x - 1, s.y) !== s.room)) s.w = internal();
            }
        });

        const furniture = new Map<any, ResolvedFurniture>();
        const wallFurniture: any[] = [];
        floor.objects.forEach(o => {
            if (o.type === 'wall') {
                const vertical = o.dir === 'N';
                for (let i = 0; i < Number(o.length); i++) {
                    const x = Number(o.x) + (vertical ? 0 : i), y = Number(o.y) + (vertical ? i : 0);
                    if (x < 0 || y < 0 || x >= width + (vertical ? 1 : 0) || y >= height + (vertical ? 0 : 1)) continue;
                    const s = at(x, y)!;
                    s[vertical ? 'w' : 'n'] = wall(s.exterior ? o.Tile : o.InteriorTile, s.exterior ? o.ExteriorTrim : o.InteriorTrim, o.uid);
                }
            }
            if (o.type !== 'furniture') return;
            const f = resolveFurniture(building, o);
            if (!f) return;
            furniture.set(o, f);
            if (f.layer !== 'Walls') return;
            wallFurniture.push(o);
            const dx = o.orient === 'E' ? 1 : 0, dy = o.orient === 'S' ? 1 : 0;
            for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
                const s = at(Number(o.x) + x + dx, Number(o.y) + y + dy);
                if (!s) continue;
                const side = ['W', 'E'].includes(o.orient) ? 'w' : ['N', 'S'].includes(o.orient) ? 'n' : undefined;
                if (side) s[side] = { ...s[side], entry: 0, uid: o.uid, furniture: f.definition,
                    raw: f.definition.tiles.find(t => t.x === x && t.y === y)?.name };
            }
        });
        each(s => {
            const n = material(s.n), w = material(s.w);
            if (n && w && n !== w) {
                s.sections['Walls'] = piece(n, 'North', s.n.uid);
                s.sections['Walls2'] = piece(w, 'West', s.w.uid);
                s.orient = 'NW';
            } else if (n || w) {
                s.orient = n && w ? 'NW' : n ? 'N' : 'W';
                s.sections['Walls'] = piece(n || w, n && w ? 'NorthWest' : n ? 'North' : 'West', n ? s.n.uid : s.w.uid);
            }
        });
        each(s => {
            if (occupied(s.sections['Walls']) || s.n.furniture || s.w.furniture) return;
            const above = at(s.x, s.y - 1), left = at(s.x - 1, s.y);
            const w = above && occupied(above.sections['Walls']) && ['W', 'NW'].includes(above.orient);
            const n = left && occupied(left.sections['Walls']) && ['N', 'NW'].includes(left.orient);
            const source = w ? above!.w : n ? left!.n : undefined;
            if (source) {
                s.sections['Walls'] = piece(source.entry, 'SouthEast', source.uid);
                s.orient = n && w ? 'SE' : '';
            }
        });

        const roofTiles = (o: any, roofLevel: number) => buildRoofPlacements({
            x: Number(o.x), y: Number(o.y), width: Number(o.width), height: Number(o.height),
            level: roofLevel, roofType: o.RoofType, depth: o.Depth,
            cappedW: o.cappedW !== false && o.cappedW !== 'false', cappedN: o.cappedN !== false && o.cappedN !== 'false',
            cappedE: o.cappedE !== false && o.cappedE !== 'false', cappedS: o.cappedS !== false && o.cappedS !== 'false',
            tileset: { capTiles: building.entries[Number(o.CapTiles) - 1]?.tiles || [],
                slopeTiles: building.entries[Number(o.SlopeTiles) - 1]?.tiles || [],
                topTiles: building.entries[Number(o.TopTiles) - 1]?.tiles || [] },
        });
        const applyRoofTile = (tile: SvgTile, uid: string) => {
            const s = at(tile.x, tile.y);
            if (!s) return;
            let layer = tile.layer;
            if (['Roof', 'RoofCap'].includes(layer) && occupied(s.sections[layer])) layer += '2';
            s.sections[layer] = { ...raw(tile.name?.replace(/\.png$/, ''), uid), tag: tile.tag };
        };
        const opening = (s: Square, o: any) => {
            if (includeStructure) openings.set(`${s.x}:${s.y}:${o.dir === 'W' ? 'W' : 'N'}`, { kind: o.type, uid: o.uid });
            const side = o.dir === 'W' ? 'West' : 'North';
            const door = o.type === 'door', layer = door ? 'Doors' : 'Windows', other = door ? 'Windows' : 'Doors';
            s.sections[layer] = piece(o.Tile, side, o.uid); // None still punches an opening.
            if (s.sections[other]?.enum === side) delete s.sections[other];
            if (door) s.sections['Frames'] = piece(o.FrameTile, side, o.uid);
            const suffix = door ? 'Door' : 'Window';
            if (s.orient === 'NW' && !occupied(s.sections['Walls2'])) {
                const original = s.sections['Walls'];
                s.sections['Walls'] = original && { ...original, enum: side === 'West' ? 'North' : 'West' };
                s.sections['Walls2'] = original && { ...original, enum: side + suffix };
            } else if (s.orient) {
                for (const wallLayer of ['Walls', 'Walls2']) {
                    const p = s.sections[wallLayer];
                    if (p && p.enum.startsWith(side)) s.sections[wallLayer] = { ...p, enum: side + suffix };
                }
            }
            if (door) return;
            const curtains = s.exterior ? at(s.x - (side === 'West' ? 1 : 0), s.y - (side === 'North' ? 1 : 0)) : s;
            if (curtains) curtains.sections[s.exterior ? 'Curtains2' : 'Curtains'] = piece(o.CurtainsTile,
                s.exterior ? side === 'West' ? 'East' : 'South' : side, o.uid);
            if (s.exterior) {
                const shutters = (target: Square | undefined, first: boolean) => {
                    if (!target?.exterior) return;
                    const name = side === 'North' ? first ? 'NorthLeft' : 'NorthRight' : first ? 'WestAbove' : 'WestBelow';
                    const t = building.entries[Number(o.ShuttersTile) - 1]?.tiles.find(t => t.enum === name);
                    if (t) insert(target, raw(t.tile, o.uid), ['WallFurniture', 'WallFurniture2']);
                };
                shutters(at(s.x - (side === 'North' ? 1 : 0), s.y - (side === 'West' ? 1 : 0)), true);
                shutters(s, true); shutters(s, false);
                shutters(at(s.x + (side === 'North' ? 1 : 0), s.y + (side === 'West' ? 1 : 0)), false);
            }
        };
        floor.objects.forEach(o => {
            const x = Number(o.x), y = Number(o.y), s = at(x, y);
            if (s && ['door', 'window'].includes(o.type)) opening(s, o);
            if (o.type === 'stairs') {
                const side = o.dir === 'N' ? 'North' : 'West';
                for (let i = 1; i <= 3; i++) {
                    const sx = x + (side === 'West' ? i : 0), sy = y + (side === 'North' ? i : 0);
                    const tile = building.entries[Number(o.Tile) - 1]?.tiles.find(t => t.enum === side + (4 - i));
                    if (sx < width && sy < height && tile) insert(at(sx, sy), raw(tile.tile, o.uid), ['Furniture', 'Furniture2', 'Furniture3', 'Furniture4']);
                }
            }
            const f = furniture.get(o);
            if (f && f.layer !== 'Walls') {
                const shifted = ['RoofCap', 'Frames', 'Doors'].includes(f.layer);
                const dx = shifted && o.orient === 'E' ? 1 : 0, dy = shifted && o.orient === 'S' ? 1 : 0;
                const front = ['W', 'N'].includes(f.definition.orient);
                const layers = f.layer === 'Furniture' ? ['Furniture', 'Furniture2', 'Furniture3', 'Furniture4']
                    : f.layer === 'WallFurniture' || f.layer === 'WallOverlay' ? front ? [f.layer, f.layer + '2'] : [f.layer + '3', f.layer + '4']
                    : ['Roof', 'RoofCap'].includes(f.layer) ? [f.layer, f.layer + '2'] : [f.layer];
                f.definition.tiles.forEach(t => {
                    const sx = x + t.x + dx, sy = y + t.y + dy;
                    if (sx < width + dx && sy < height + dy) insert(at(sx, sy), raw(t.name, o.uid), layers);
                });
            }
            if (o.type === 'roof') roofTiles(o, level).forEach(tile => {
                if (tile.level === level) applyRoofTile(tile, o.uid);
            });
        });
        wallFurniture.forEach(o => {
            const f = furniture.get(o)!;
            const dx = o.orient === 'E' ? 1 : 0, dy = o.orient === 'S' ? 1 : 0;
            for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
                const s = at(Number(o.x) + x + dx, Number(o.y) + y + dy);
                if (!s) continue;
                const layer = occupied(s.sections['Walls']) || occupied(s.tiles['Walls']) ? 'Walls2' : 'Walls';
                const t = f.definition.tiles.find(t => t.x === x && t.y === y);
                s.tiles[layer] = t ? raw(t.name, o.uid) : undefined;
                delete s.sections[layer];
                const side = ['W', 'E'].includes(o.orient) ? 'W' : ['N', 'S'].includes(o.orient) ? 'N' : '';
                if (side) s.orient = s.orient === (side === 'W' ? 'N' : 'W') ? 'NW' : side;
            }
        });
        if (includeStructure) each(s => {
            for (const axis of ['N', 'W'] as const) {
                if (axis === 'N' ? s.x >= width : s.y >= height) continue;
                const side = axis === 'N' ? s.n : s.w;
                result.edges!.push({ level, x: s.x, y: s.y, axis,
                    wall: !!material(side) || !!(side.furniture && side.raw && side.raw !== 'None'),
                    ...(openings.get(`${s.x}:${s.y}:${axis}`) ? { opening: openings.get(`${s.x}:${s.y}:${axis}`) } : {}) });
            }
        });
        // Native floors overwrite zero-depth roof tops in occupied rooms.
        each(s => {
            if (s.room) s.sections['Floor'] = piece(building.rooms[s.room - 1]?.Floor, 'Floor');
        });
        const below = building.floors[level - 1];
        below?.objects.filter(o => o.type === 'roof').forEach(o => {
            roofTiles(o, level - 1).filter(t => t.level === level).forEach(t => applyRoofTile(t, o.uid));
        });
        below?.objects.filter(o => o.type === 'stairs').forEach(o => {
            const x = Number(o.x), y = Number(o.y), vertical = o.dir === 'N';
            if (x + (vertical ? 0 : 1) < 0 || x + (vertical ? 0 : 3) >= width || y + (vertical ? 1 : 0) < 0 || y + (vertical ? 3 : 0) >= height) return;
            for (let i = 1; i <= 3; i++) delete at(x + (vertical ? 0 : i), y + (vertical ? i : 0))!.sections['Floor'];
        });
        each(s => {
            let enumW = '', enumN = '', layerW = 'WallTrim2', layerN = 'WallTrim';
            for (const layer of ['Walls', 'Walls2']) {
                const p = s.sections[layer];
                if (!p || !validEntry(p.entry)) continue;
                if (p.enum === 'NorthWest') { enumW = 'West'; enumN = 'North'; }
                else if (p.enum.startsWith('West')) enumW = p.enum;
                else enumN = p.enum;
                if (layer === 'Walls2' && !p.enum.startsWith('West')) [layerW, layerN] = [layerN, layerW];
            }
            const trimW = s.w.furniture ? 0 : s.w.trim, trimN = s.n.furniture ? 0 : s.n.trim;
            if (enumW === 'West' && enumN === 'North' && trimW === trimN) {
                if (layerN === 'WallTrim2') { enumN = 'NorthWest'; enumW = ''; }
                else { enumW = 'NorthWest'; enumN = ''; }
            }
            if (enumW) s.sections[layerW] = piece(trimW, enumW);
            if (enumN) s.sections[layerN] = piece(trimN, enumN);
            if (s.sections['Walls']?.enum === 'SouthEast') {
                const trim = at(s.x, s.y - 1)?.w.trim || at(s.x - 1, s.y)?.n.trim;
                s.sections['WallTrim'] = piece(trim, 'SouthEast');
            }
            // Grime follows the final wall shapes; doorways have no floor grime.
            const room = building.rooms[s.room - 1];
            const wallGrime = s.exterior ? level === 0 ? building.GrimeWall : 0 : room?.GrimeWall;
            const floorGrime = s.exterior ? 0 : room?.GrimeFloor;
            let gw = '', gn = '', fw = '', fn = '';
            for (const layer of ['Walls', 'Walls2']) {
                const p = s.sections[layer];
                if (!p || !validEntry(p.entry)) continue;
                if (p.enum === 'NorthWest') { gw = 'NorthWest'; gn = ''; fw = 'West'; fn = 'North'; }
                else if (p.enum.startsWith('West')) { gw = p.enum; if (!p.enum.endsWith('Door')) fw = 'West'; }
                else if (p.enum.startsWith('North')) { gn = p.enum; if (!p.enum.endsWith('Door')) fn = 'North'; }
                else if (p.enum === 'SouthEast') { gw = 'SouthEast'; if (s.orient === 'SE') fw = 'NorthWest'; }
            }
            if (s.w.furniture && s.w.furniture.grime !== false) { if (s.w.raw && s.w.raw !== 'None') gw = 'West'; fw = 'West'; }
            if (s.n.furniture && s.n.furniture.grime !== false) { if (s.n.raw && s.n.raw !== 'None') gn = 'North'; fn = 'North'; }
            if (gw === 'NorthWest' && gn) gw = 'West';
            if (gw) s.sections['WallGrime'] = piece(wallGrime, gw);
            if (gn) s.sections['WallGrime2'] = piece(wallGrime, gn);
            if (fw) s.sections['FloorGrime'] = piece(floorGrime, fw);
            if (fn) s.sections['FloorGrime2'] = piece(floorGrime, fn);
        });

        const floorTiles: SvgTile[] = [];
        each(s => SQUARE_LAYERS.forEach(layer => {
            const p = s.tiles[layer] || s.sections[layer];
            if (!p) return;
            const entry = building.entries[p.entry - 1];
            const source: Tile | undefined = p.raw !== undefined ? { tile: p.raw } : entry?.tiles.find(t => t.enum === p.enum);
            if (!source?.tile || source.tile === 'None') return;
            const name = source.tile + '.png';
            floorTiles.push({ name, url: name, x: s.x, y: s.y, layer, level, object: p.uid,
                auto: !p.uid, tag: p.tag });
        }));
        result.tiles.push(...floorTiles);
        floor.objects.forEach(o => {
            const f = furniture.get(o), vertical = o.dir === 'N';
            const width = o.type === 'roof' ? Number(o.width) : f?.width || (o.type === 'stairs' && !vertical ? 5 : o.type === 'wall' && !vertical ? Number(o.length) : 1);
            const height = o.type === 'roof' ? Number(o.height) : f?.height || (o.type === 'stairs' && vertical ? 5 : o.type === 'wall' && vertical ? Number(o.length) : 1);
            const edgeFurniture = f && ['Walls', 'Frames', 'Doors', 'RoofCap'].includes(f.layer);
            const facing = o.orient === 'E' ? 'W' : o.orient === 'S' ? 'N' : o.orient;
            result.objects.push({ uid: o.uid, x: Number(o.x) + (edgeFurniture && o.orient === 'E' ? 1 : 0),
                y: Number(o.y) + (edgeFurniture && o.orient === 'S' ? 1 : 0), level,
                tiles: floorTiles.filter(tile => tile.object === o.uid), width: height - 1, length: width - 1,
                orient: o.type === 'wall' ? vertical ? 'W' : 'N' : facing || o.dir || o.RoofType,
                type: f?.layer === 'Walls' ? 'Wall' : f?.layer === 'WallFurniture' ? 'WallFurniture'
                    : o.type === 'roof' ? 'roof' : o.type.charAt(0).toUpperCase() + o.type.slice(1),
                cappedW: o.cappedW !== false && o.cappedW !== 'false', cappedN: o.cappedN !== false && o.cappedN !== 'false',
                cappedE: o.cappedE !== false && o.cappedE !== 'false', cappedS: o.cappedS !== false && o.cappedS !== 'false' });
        });
    });
    return result;
}
