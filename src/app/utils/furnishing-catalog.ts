import { Furniture, FurnitureTileEntry, Point } from '../models/app.models';
import { BFurniture } from '../models/furniture-window.models';
import { FurnishingCatalog, FurnishingCatalogItem, FurnishingRoomType, FurnitureFacing, FurnitureVariantMetadata } from '../models/auto-furnishing.models';
import { parseFurnitureGroups } from './furniture-catalog-parser';

interface CatalogSpec {
    id: string; label: string; group: string; tile: string; role: string; rooms: FurnishingRoomType[];
    layer?: string;
    style?: string;
    movement: boolean; access: 'front' | 'bed-side' | 'none'; wall: boolean; surface?: boolean;
}
// Versioned, deliberately small whitelist. Metadata is editor clearance policy, not game collision flags.
export const FURNISHING_CATALOG_VERSION = 2;
export const FURNISHING_CATALOG_SPECS: readonly CatalogSpec[] = [
    { id: 'basic.single-bed', label: 'Single bed', group: 'Furniture - Bedding', tile: 'furniture_bedding_01_002', role: 'bed', rooms: ['bedroom'], movement: true, access: 'bed-side', wall: true },
    { id: 'basic.double-bed', label: 'Double bed', group: 'Furniture - Bedding', tile: 'furniture_bedding_01_014', role: 'bed', rooms: ['bedroom'], movement: true, access: 'bed-side', wall: true },
    { id: 'basic.sofa', label: 'Two-seat sofa', group: 'Furniture - Seating - Indoor', tile: 'furniture_seating_indoor_01_003', role: 'sofa', rooms: ['livingroom'], movement: true, access: 'front', wall: false },
    { id: 'basic.chair', label: 'Chair', group: 'Furniture - Seating - Indoor', tile: 'furniture_seating_indoor_01_013', role: 'chair', rooms: ['diningroom', 'office', 'bedroom'], movement: true, access: 'front', wall: false },
    { id: 'basic.dining-table', label: 'Dining table', group: 'Furniture - Tables - High', tile: 'furniture_tables_high_01_003', role: 'dining-table', rooms: ['diningroom', 'kitchen'], movement: true, access: 'none', wall: false, surface: true },
    { id: 'basic.toilet', label: 'Toilet', group: 'Fixtures - Bathroom', tile: 'fixtures_bathroom_01_001', role: 'toilet', rooms: ['bathroom'], movement: true, access: 'front', wall: true },
    { id: 'basic.sink', label: 'Sink', group: 'Fixtures - Sinks', tile: 'fixtures_sinks_01_001', role: 'sink', rooms: ['bathroom', 'kitchen'], movement: true, access: 'front', wall: true },
    { id: 'basic.refrigerator', label: 'Refrigerator', group: 'Appliances - Refrigeration', tile: 'appliances_refrigeration_01_001', role: 'refrigerator', rooms: ['kitchen'], movement: true, access: 'front', wall: true },
    { id: 'basic.cooker', label: 'Cooker', group: 'Appliances - Cooking', tile: 'appliances_cooking_01_000', role: 'cooker', rooms: ['kitchen'], movement: true, access: 'front', wall: true },
    { id: 'basic.counter', label: 'Kitchen counter', group: 'Fixtures - Counters', tile: 'fixtures_counters_01_003', role: 'counter', rooms: ['kitchen'], movement: true, access: 'front', wall: true, surface: true },
    { id: 'basic.rug', label: 'Small rug', group: 'Floors - Rugs', tile: 'floors_rugs_01_000', layer: 'FloorFurniture', role: 'rug', rooms: ['bedroom', 'livingroom', 'diningroom', 'hall'], movement: false, access: 'none', wall: false },
    { id: 'basic.coffee-table', label: 'Coffee table', group: 'Furniture - Tables - Low', tile: 'furniture_tables_low_01_001', role: 'coffee-table', rooms: ['livingroom'], movement: true, access: 'none', wall: false, surface: true },
    { id: 'basic.armchair', label: 'Armchair', group: 'Furniture - Seating - Indoor', tile: 'furniture_seating_indoor_01_008', role: 'armchair', rooms: ['livingroom'], movement: true, access: 'front', wall: false },
    { id: 'basic.television', label: 'Television', group: 'Applicances - Television', tile: 'appliances_television_01_000', role: 'television', rooms: ['livingroom'], movement: true, access: 'front', wall: false },
    { id: 'alternate.sofa', label: 'Alternate two-seat sofa', group: 'Furniture - Seating - Indoor', tile: 'furniture_seating_indoor_02_027', role: 'sofa', rooms: ['livingroom'], style: 'alternate-residential', movement: true, access: 'front', wall: false },
    { id: 'alternate.armchair', label: 'Alternate armchair', group: 'Furniture - Seating - Indoor', tile: 'furniture_seating_indoor_02_021', role: 'armchair', rooms: ['livingroom'], style: 'alternate-residential', movement: true, access: 'front', wall: false },
    { id: 'alternate.chair', label: 'Alternate chair', group: 'Furniture - Seating - Indoor', tile: 'furniture_seating_indoor_02_040', role: 'chair', rooms: ['diningroom', 'office', 'bedroom'], style: 'alternate-residential', movement: true, access: 'front', wall: false },
    { id: 'alternate.dining-table', label: 'Alternate dining table', group: 'Furniture - Tables - High', tile: 'furniture_tables_high_01_011', role: 'dining-table', rooms: ['diningroom', 'kitchen'], style: 'alternate-residential', movement: true, access: 'none', wall: false, surface: true },
    { id: 'alternate.coffee-table', label: 'Alternate coffee table', group: 'Furniture - Tables - Low', tile: 'furniture_tables_low_01_011', role: 'coffee-table', rooms: ['livingroom'], style: 'alternate-residential', movement: true, access: 'none', wall: false, surface: true },
    { id: 'alternate.counter', label: 'Alternate kitchen counter', group: 'Fixtures - Counters', tile: 'fixtures_counters_01_011', role: 'counter', rooms: ['kitchen'], style: 'alternate-residential', movement: true, access: 'front', wall: true, surface: true },
    { id: 'alternate.sink', label: 'Alternate sink', group: 'Fixtures - Sinks', tile: 'fixtures_sinks_01_021', role: 'sink', rooms: ['kitchen', 'bathroom'], style: 'alternate-residential', movement: true, access: 'front', wall: true }
];
const facings: FurnitureFacing[] = ['W', 'N', 'E', 'S'];
export function furnitureVariantKey(entry: FurnitureTileEntry, layer = 'Furniture'): string {
    return JSON.stringify([layer, entry.tiles.map(tile => [tile.x, tile.y, tile.name.replace(/\.png$/, '')])
        .sort((a, b) => Number(a[1]) - Number(b[1]) || Number(a[0]) - Number(b[0]) || String(a[2]).localeCompare(String(b[2])))]);
}
function definition(source: BFurniture): Furniture {
    return { layer: source.layer || 'Furniture', corners: source.corners || false, entries: source.entries.map(entry => ({
        orient: entry.orient, grime: entry.grime,
        tiles: entry.items.map(item => ({ x: Number(item.pos.split(',')[0]), y: Number(item.pos.split(',')[1]), name: item.tile })) })) };
}
function variant(entry: FurnitureTileEntry, spec: CatalogSpec): FurnitureVariantMetadata {
    const orient = entry.orient as FurnitureFacing;
    const width = Math.max(...entry.tiles.map(tile => tile.x)) + 1, height = Math.max(...entry.tiles.map(tile => tile.y)) + 1;
    const footprint: Point[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) footprint.push({ x, y });
    const edge = (side: FurnitureFacing, outside: boolean): Point[] => {
        if (side === 'W' || side === 'E') return Array.from({ length: height }, (_, y) => ({ x: side === 'W' ? outside ? -1 : 0 : outside ? width : width - 1, y }));
        return Array.from({ length: width }, (_, x) => ({ x, y: side === 'N' ? outside ? -1 : 0 : outside ? height : height - 1 }));
    };
    const front: Record<FurnitureFacing, FurnitureFacing> = { W: 'E', N: 'S', E: 'W', S: 'N' };
    const bedSide: Record<FurnitureFacing, FurnitureFacing> = { W: 'S', N: 'E', E: 'N', S: 'W' };
    return { orient, renderCells: entry.tiles.map(tile => ({ x: tile.x, y: tile.y })), footprint,
        blockedCells: spec.movement ? footprint.map(cell => ({ ...cell })) : [],
        accessCells: spec.access === 'none' ? [] : edge(spec.access === 'bed-side' ? bedSide[orient] : front[orient], true),
        wallEdges: spec.wall ? edge(orient, false).map(cell => ({ ...cell, side: orient })) : [],
        surfaceCells: spec.surface ? footprint.map(cell => ({ ...cell })) : [] };
}
export function buildFurnishingCatalog(source: string): FurnishingCatalog {
    const groups = parseFurnitureGroups(source), result: FurnishingCatalog = { version: FURNISHING_CATALOG_VERSION, items: [], diagnostics: [] };
    for (const spec of FURNISHING_CATALOG_SPECS) {
        const candidates = groups.filter(group => group.label === spec.group).flatMap(group => group.furniture)
            .filter(item => (item.layer || 'Furniture') === (spec.layer || 'Furniture') && item.entries.some(entry => entry.orient === 'W' &&
                entry.items.some(tile => tile.tile === spec.tile && tile.pos.split(',').every(value => Number(value) === 0))))
            .map(definition).sort((a, b) => b.entries.length - a.entries.length);
        const sourceItem = candidates[0];
        if (!sourceItem) {
            result.diagnostics.push({ code: 'catalog-source-missing', catalogId: spec.id, message: `No source furniture matches ${spec.label}.` }); continue;
        }
        const signature = (item: Furniture) => JSON.stringify([!!item.corners, item.entries.map(entry => [entry.orient, entry.grime !== false, furnitureVariantKey(entry, item.layer)])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
        if (candidates.some(candidate => candidate.entries.length === sourceItem.entries.length && signature(candidate) !== signature(sourceItem))) {
            result.diagnostics.push({ code: 'catalog-source-ambiguous', catalogId: spec.id, message: `Multiple incompatible definitions match ${spec.label}.` }); continue;
        }
        // Some native groups repeat W/N entries with additional E/S variants. Prefer the complete definition.
        const entries = sourceItem.entries.filter(entry => facings.includes(entry.orient as FurnitureFacing) && entry.tiles.length);
        const neutral = ['bed', 'toilet', 'refrigerator', 'cooker', 'television', 'rug'].includes(spec.role);
        const item: FurnishingCatalogItem = { id: spec.id, label: spec.label, role: spec.role, style: spec.style || 'basic-residential', weight: 1,
            ...(neutral ? { compatibleStyles: ['basic-residential', 'alternate-residential'] } : {}),
            roomTypes: [...spec.rooms], support: 'floor', definition: sourceItem, variants: entries.map(entry => variant(entry, spec)),
            requiredTiles: [...new Set(entries.flatMap(entry => entry.tiles.map(tile => tile.name + '.png')))].sort() };
        result.items.push(item);
    }
    return result;
}
