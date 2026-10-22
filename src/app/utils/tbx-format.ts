import { Building, Furniture, FurnitureTileEntry, Room, Tile } from '../models/app.models';
import { GUID } from './guid';
import { readIndexGrid, writeIndexGrid } from './tbx-grid';

export const TBX_VERSION = 3;
const buildingTiles = ['ExteriorWall', 'ExteriorWallTrim', 'Door', 'DoorFrame', 'Window', 'Curtains',
    'Shutters', 'Stairs', 'RoofCap', 'RoofSlope', 'RoofTop', 'GrimeWall'] as const;
const roomTiles = ['InteriorWall', 'InteriorWallTrim', 'Floor', 'GrimeFloor', 'GrimeWall'] as const;
const objectTiles = ['Tile', 'FrameTile', 'CurtainsTile', 'ShuttersTile', 'InteriorTile', 'ExteriorTrim',
    'InteriorTrim', 'CapTiles', 'SlopeTiles', 'TopTiles'];

function children(element: Element, name: string): Element[] {
    return Array.from(element.children).filter(child => child.tagName === name);
}

function integer(value: string | number | null | undefined, label: string): number {
    if (typeof value === 'string' && value !== '' && !/^\d+$/.test(value.trim())) throw new Error(`Invalid ${label}: '${value}'.`);
    const number = value == null || value === '' ? 0 : Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label}: '${value}'.`);
    return number;
}

function optionalBoolean(element: Element, name: string): boolean | undefined {
    const value = element.getAttribute(name);
    if (value === null) return undefined;
    if (value !== 'true' && value !== 'false') throw new Error(`Invalid ${name}: '${value}'.`);
    return value === 'true';
}

function readTile(element: Element): Tile {
    const tile: Tile = { tile: element.getAttribute('tile') || '' };
    if (element.hasAttribute('enum')) tile.enum = element.getAttribute('enum')!;
    if (element.hasAttribute('offset')) tile.offset = element.getAttribute('offset')!;
    return tile;
}

/** Read native v2/v3 and recover the old web app's v0 format. */
export function readBuildingFile(xml: Document): Building {
    const root = xml.documentElement;
    if (!root || root.tagName !== 'building' || xml.getElementsByTagName('parsererror').length) {
        throw new Error('This file is not a valid TBX building XML document.');
    }
    const version = root.getAttribute('version');
    if (version !== '0' && version !== '2' && version !== '3') {
        if (version === '1' || version === '1.0') {
            throw new Error('TBX version 1 uses legacy tile names. Open and save it in desktop BuildingEd before importing it.');
        }
        throw new Error(`Unsupported TBX version '${version}'.`);
    }

    const building: Building = {
        version: TBX_VERSION,
        width: integer(root.getAttribute('width'), 'building width'),
        height: integer(root.getAttribute('height'), 'building height'),
        ...Object.fromEntries(buildingTiles.map(key => [key, integer(root.getAttribute(key), key)])) as Pick<Building, typeof buildingTiles[number]>,
        properties: Object.fromEntries(children(root, 'properties').flatMap(group => children(group, 'property'))
            .map(property => [property.getAttribute('name') || '', property.getAttribute('value') ?? property.textContent ?? ''])),
        entries: children(root, 'tile_entry').map(entry => ({
            category: entry.getAttribute('category') || '', tiles: children(entry, 'tile').map(readTile),
        })),
        furniture: children(root, 'furniture').map(item => ({
            ...(item.hasAttribute('layer') ? { layer: item.getAttribute('layer')! } : {}),
            ...(item.hasAttribute('corners') ? { corners: optionalBoolean(item, 'corners') } : {}),
            entries: children(item, 'entry').map(entry => ({
                orient: entry.getAttribute('orient') || '',
                ...(entry.hasAttribute('grime') ? { grime: optionalBoolean(entry, 'grime') } : {}),
                tiles: children(entry, 'tile').map(tile => ({
                    x: integer(tile.getAttribute('x'), 'furniture x'),
                    y: integer(tile.getAttribute('y'), 'furniture y'), name: tile.getAttribute('name') || '',
                })),
            })),
        })),
        user_tiles: children(root, 'user_tiles').flatMap(group => children(group, 'tile')).map(readTile),
        used_tiles: children(root, 'used_tiles')[0]?.textContent || '',
        used_furniture: children(root, 'used_furniture')[0]?.textContent || '',
        rooms: children(root, 'room').map(room => ({
            Name: room.getAttribute('Name') || '', InternalName: room.getAttribute('InternalName') || '',
            Color: room.getAttribute('Color') || '255 255 255',
            ...Object.fromEntries(roomTiles.map(key => [key, integer(room.getAttribute(key), key)])) as Pick<Room, typeof roomTiles[number]>,
        })),
        floors: children(root, 'floor').map(floor => ({
            objects: children(floor, 'object').map(object => ({
                ...Object.fromEntries(Array.from(object.attributes).map(attr => [attr.name, attr.value])),
                uid: GUID.generateGUID(),
            })),
            rooms: children(floor, 'rooms')[0]?.textContent || '',
            tileLayers: children(floor, 'tiles').map(layer => ({
                layer: layer.getAttribute('layer') || '', tiles: layer.textContent || '',
            })),
        })),
    };
    return normalizeBuildingFile(building);
}

/** Validate indices without renumbering the native one-based tile and zero-based furniture tables. */
export function normalizeBuildingFile(building: Building): Building {
    if (![0, 2, TBX_VERSION].includes(building.version)) throw new Error(`Unsupported TBX version '${building.version}'.`);
    const width = integer(building.width, 'building width');
    const height = integer(building.height, 'building height');
    if (!width || !height) throw new Error('Building dimensions must be greater than zero.');
    const reference = (value: string | number, count: number, label: string, zeroBased = false): number => {
        const index = integer(value, label);
        if (index >= count + (zeroBased ? 0 : 1)) throw new Error(`${label} index ${index} is out of range.`);
        return index;
    };
    buildingTiles.forEach(key => reference(building[key], building.entries.length, key));
    building.rooms.forEach(room => roomTiles.forEach(key => reference(room[key], building.entries.length, `Room ${room.Name} ${key}`)));
    const list = (value: string, count: number, label: string, zeroBased = false): string =>
        value.trim() ? value.trim().split(/\s+/).map(item => reference(item, count, label, zeroBased)).join(' ') : '';
    building.furniture.forEach(item => {
        item.entries.forEach(entry => {
            if (!['W', 'N', 'E', 'S', 'SW', 'NW', 'NE', 'SE'].includes(entry.orient)) {
                throw new Error(`Invalid furniture orientation '${entry.orient}'.`);
            }
        });
    });
    return {
        ...building, version: TBX_VERSION, width, height,
        used_tiles: list(building.used_tiles, building.entries.length, 'used_tiles'),
        used_furniture: list(building.used_furniture, building.furniture.length, 'used_furniture', true),
        floors: building.floors.map((floor, level) => {
            const rooms = readIndexGrid(floor.rooms, width, height, true);
            rooms.forEach(row => row.forEach(value => reference(value, building.rooms.length, `Floor ${level} room`)));
            floor.objects.forEach(object => {
                objectTiles.forEach(key => {
                    if (object[key] !== undefined) reference(object[key], building.entries.length, `Floor ${level} ${key}`);
                });
                if (object.type === 'furniture') {
                    reference(object.FurnitureTiles, building.furniture.length, 'FurnitureTiles', true);
                    if (!['W', 'N', 'E', 'S', 'SW', 'NW', 'NE', 'SE'].includes(object.orient)) throw new Error(`Invalid furniture orientation '${object.orient}'.`);
                }
            });
            return {
                ...floor, rooms: writeIndexGrid(rooms),
                tileLayers: floor.tileLayers?.map(layer => {
                    if (!layer.layer) throw new Error('A TBX tile layer is missing its name.');
                    const tiles = readIndexGrid(layer.tiles, width + 1, height + 1);
                    tiles.forEach(row => row.forEach(value => reference(value, building.user_tiles.length, `Floor ${level} user tile`)));
                    return { ...layer, tiles: writeIndexGrid(tiles) };
                }),
            };
        }),
    };
}

export function writeBuildingFile(source: Building): XMLDocument {
    const building = normalizeBuildingFile(source);
    const xml = document.implementation.createDocument('', 'building', null);
    const root = xml.documentElement;
    const append = (parent: Element, name: string, attrs: Record<string, unknown> = {}, text?: string): Element => {
        const element = xml.createElement(name);
        Object.entries(attrs).forEach(([key, value]) => {
            if (value !== undefined && value !== null) element.setAttribute(key, String(value));
        });
        if (text !== undefined) element.textContent = text;
        parent.appendChild(element);
        return element;
    };
    root.setAttribute('version', String(TBX_VERSION));
    root.setAttribute('width', String(building.width));
    root.setAttribute('height', String(building.height));
    buildingTiles.forEach(key => root.setAttribute(key, String(building[key])));
    if (building.properties && Object.keys(building.properties).length) {
        const properties = append(root, 'properties');
        Object.entries(building.properties).forEach(([name, value]) => {
            append(properties, 'property', value.includes('\n') ? { name } : { name, value }, value.includes('\n') ? value : undefined);
        });
    }
    building.entries.forEach(entry => {
        const element = append(root, 'tile_entry', { category: entry.category });
        entry.tiles.forEach(tile => append(element, 'tile', { enum: tile.enum, tile: tile.tile, offset: tile.offset }));
    });
    building.furniture.forEach((item: Furniture) => {
        const element = append(root, 'furniture', { layer: item.layer, corners: item.corners });
        item.entries.forEach((entry: FurnitureTileEntry) => {
            const orient = append(element, 'entry', { orient: entry.orient, grime: entry.grime });
            entry.tiles.forEach(tile => append(orient, 'tile', { x: tile.x, y: tile.y, name: tile.name }));
        });
    });
    const userTiles = append(root, 'user_tiles');
    building.user_tiles.forEach(tile => append(userTiles, 'tile', { enum: tile.enum, tile: tile.tile, offset: tile.offset }));
    append(root, 'used_tiles', {}, building.used_tiles);
    append(root, 'used_furniture', {}, building.used_furniture);
    building.rooms.forEach(room => append(root, 'room', { ...room }));
    building.floors.forEach(floor => {
        const element = append(root, 'floor');
        floor.objects.forEach(object => {
            const { uid, ...attributes } = object;
            append(element, 'object', attributes);
        });
        append(element, 'rooms', {}, floor.rooms);
        floor.tileLayers?.forEach(layer => append(element, 'tiles', { layer: layer.layer }, layer.tiles));
    });
    return xml;
}
