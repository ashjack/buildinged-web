import { Building, Point } from '../models/app.models';
import { FurnishingCatalogItem, FurnishingPreparation } from '../models/auto-furnishing.models';
import { nativeBuildingXml } from './native-building.fixture';
import { readBuildingFile } from '../utils/tbx-format';
import { writeIndexGrid } from '../utils/tbx-grid';
import { analyzeFurnishingRooms } from '../utils/furnishing-room-analysis';

export function furnishingBuilding(grid = Array.from({ length: 6 }, () => Array(6).fill(1))): Building {
    const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    building.width = grid[0].length; building.height = grid.length;
    building.entries = [
        { category: 'interior_walls', tiles: ['West', 'North', 'NorthWest', 'SouthEast', 'WestDoor', 'NorthDoor', 'WestWindow', 'NorthWindow'].map(value => ({ enum: value, tile: `wall-${value}` })) },
        { category: 'floors', tiles: [{ enum: 'Floor', tile: 'floor_000' }] }
    ];
    building.ExteriorWall = 1; building.ExteriorWallTrim = building.GrimeWall = 0;
    building.Door = building.DoorFrame = building.Window = building.Curtains = building.Shutters = building.Stairs = building.RoofCap = building.RoofSlope = building.RoofTop = 0;
    building.rooms = ['bedroom', 'bathroom'].map(name => ({ Name: name, InternalName: name, Color: '200 200 200',
        InteriorWall: 1, InteriorWallTrim: 0, Floor: 2, GrimeFloor: 0, GrimeWall: 0 }));
    building.furniture = []; building.user_tiles = []; building.used_tiles = building.used_furniture = '';
    building.floors = [{ rooms: writeIndexGrid(grid), objects: [{ uid: 'entry', type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 }] }];
    return building;
}
export function furnishingItem(id: string, options: { width?: number; height?: number; blocks?: boolean; access?: Point[];
    wall?: boolean; surface?: boolean; support?: 'floor' | 'surface'; style?: string; role?: string; layer?: string } = {}): FurnishingCatalogItem {
    const footprint: Point[] = [];
    for (let y = 0; y < (options.height || 1); y++) for (let x = 0; x < (options.width || 1); x++) footprint.push({ x, y });
    const tiles = footprint.map((cell, index) => ({ ...cell, name: `${id}_${index.toString().padStart(3, '0')}` }));
    return { id, label: id, role: options.role || id, style: options.style || 'basic', weight: 1, roomTypes: ['bedroom', 'bathroom'], support: options.support || 'floor',
        definition: { layer: options.layer || 'Furniture', entries: [{ orient: 'W', tiles }] }, requiredTiles: tiles.map(tile => tile.name + '.png'),
        variants: [{ orient: 'W', renderCells: footprint.map(cell => ({ ...cell })), footprint,
            blockedCells: options.blocks === false ? [] : footprint.map(cell => ({ ...cell })), accessCells: options.access || [],
            wallEdges: options.wall ? [{ x: 0, y: 0, side: 'W' }] : [], surfaceCells: options.surface ? footprint.map(cell => ({ ...cell })) : [] }] };
}
export function furnishingPreparation(building: Building, items = [furnishingItem('crate')]): FurnishingPreparation {
    const catalog = { version: 1, items, diagnostics: [] };
    return { catalog, analysis: analyzeFurnishingRooms(building, catalog),
        availability: items.flatMap(item => item.variants.map(variant => ({ catalogId: item.id, orient: variant.orient, available: true, missingTiles: [] }))) };
}
