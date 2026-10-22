import { Furniture } from '../models/app.models';
import { VisualFurniture } from '../models/furniture-window.models';

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
