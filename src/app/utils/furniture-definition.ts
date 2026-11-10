import { Building, Furniture } from '../models/app.models';
import { VisualFurniture, VisualFurnitureEntry } from '../models/furniture-window.models';

/** Wall definitions may omit the other facings: native FurnitureTile::resolved reuses their artwork. */
export function furnitureEntryForPlacement(furniture: VisualFurniture, orient: string): VisualFurnitureEntry | undefined {
    const entry = furniture.entries.find(entry => entry.orient === orient && entry.tiles.length > 0);
    if (entry || furniture.layer !== 'Walls') return entry;
    const populated = (facing: string) => furniture.entries.find(entry => entry.orient === facing && entry.tiles.length > 0);
    if (orient === 'S') return populated('N') ?? populated('W');
    if (orient === 'N' || orient === 'E') return populated('W');
    return undefined;
}

export function furnitureEntrySize(entry: VisualFurnitureEntry | undefined): { width: number; height: number } {
    const tiles = entry?.tiles ?? [];
    return { width: Math.max(1, ...tiles.map(tile => tile.x + 1)), height: Math.max(1, ...tiles.map(tile => tile.y + 1)) };
}

/** Validate the rendered wall tiles, including the extra boundary grid line. */
export function wallFurnitureFits(building: Building, x: number, y: number, orient: string, size: { width: number; height: number }): boolean {
    const tx = x + (orient === 'E' ? 1 : 0), ty = y + (orient === 'S' ? 1 : 0);
    if (tx + size.width > building.width + 1 || ty + size.height > building.height + 1) return false;
    if (['W', 'E'].includes(orient) && y + size.height > building.height) return false;
    if (['N', 'S'].includes(orient) && x + size.width > building.width) return false;
    return true;
}

export function furnitureDefinition(visual: VisualFurniture): Furniture {
    return {
        layer: visual.layer,
        corners: visual.corners,
        entries: visual.entries.map(entry => ({
            orient: entry.orient, grime: entry.grime,
            tiles: entry.tiles.map(tile => ({ x: tile.x, y: tile.y, name: (tile.name || '').replace(/\.png$/, '') })),
        })),
    };
}

function key(item: Furniture): string {
    return JSON.stringify({
        layer: item.layer || 'Furniture', corners: item.corners || false,
        entries: item.entries.map(entry => ({
            orient: entry.orient, grime: entry.grime !== false,
            tiles: entry.tiles.map(tile => ({ x: tile.x, y: tile.y, name: tile.name }))
                .sort((a, b) => a.x - b.x || a.y - b.y || a.name.localeCompare(b.name)),
        })).sort((a, b) => a.orient.localeCompare(b.orient)),
    });
}

export function registerFurniture(items: Furniture[], definition: Furniture): { furniture: Furniture[]; index: number } {
    const definitionKey = key(definition);
    const index = items.findIndex(item => key(item) === definitionKey);
    return index < 0 ? { furniture: [...items, definition], index: items.length } : { furniture: items, index };
}
