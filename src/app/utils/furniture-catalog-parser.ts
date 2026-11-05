import { BFurnitureGroup, FurnitureDocument } from '../models/furniture-window.models';

/** Entry order and layer names used by the desktop editor when writing BuildingFurniture.txt. */
export const FURNITURE_ORIENTS = ['W', 'N', 'E', 'S', 'SW', 'NW', 'NE', 'SE'] as const;
export const FURNITURE_LAYERS = ['Walls', 'RoofCap', 'WallOverlay', 'WallFurniture', 'Furniture', 'Frames', 'Doors', 'Roof', 'FloorFurniture'] as const;

interface Block { name: string; values: Record<string, string>; children: Block[]; }
/** Shared parser for native BuildingFurniture.txt; coordinates and orientation stay source-authored. */
export function parseFurnitureGroups(text: string): BFurnitureGroup[] {
    return parseFurnitureDocument(text).groups;
}

export function parseFurnitureDocument(text: string): FurnitureDocument {
    const root: Block = { name: '', values: {}, children: [] }, stack = [root];
    let pending = '';
    for (const part of text.replace(/^\uFEFF/, '').replace(/\/\/[^\r\n]*/g, '').split(/([{}]|\r?\n)/)) {
        const line = part.trim(); if (!line) continue;
        if (line === '{') {
            if (!pending) throw new Error('Furniture block has no name.');
            const block: Block = { name: pending, values: {}, children: [] };
            stack[stack.length - 1].children.push(block); stack.push(block); pending = ''; continue;
        }
        if (line === '}') {
            if (stack.length === 1) throw new Error('Unexpected furniture closing brace.');
            stack.pop(); pending = ''; continue;
        }
        const separator = line.indexOf('=');
        if (separator < 0) { pending = line; continue; }
        stack[stack.length - 1].values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    if (stack.length !== 1) throw new Error('Unclosed furniture block.');
    const revision = (key: string) => Math.max(0, Number.parseInt(root.values[key], 10) || 0);
    const groups = root.children.filter(block => block.name === 'group').map(group => ({
        label: group.values['label'] || '',
        furniture: group.children.filter(block => block.name === 'furniture').map(furniture => ({
            ...(furniture.values['layer'] ? { layer: furniture.values['layer'] } : {}),
            ...(furniture.values['corners'] ? { corners: furniture.values['corners'] === 'true' } : {}),
            entries: furniture.children.filter(block => block.name === 'entry').map(entry => {
                const orient = entry.values['orient'];
                if (!['W', 'N', 'E', 'S', 'NW', 'NE', 'SW', 'SE'].includes(orient)) throw new Error(`Invalid furniture orientation '${orient}'.`);
                return { orient, ...(entry.values['grime'] ? { grime: entry.values['grime'] !== 'false' } : {}),
                    items: Object.entries(entry.values).filter(([key, value]) => key.includes(',') && value).map(([pos, tile]) => {
                        if (!/^\d+,\s*\d+$/.test(pos)) throw new Error(`Invalid furniture coordinate '${pos}'.`);
                        return { pos, tile };
                    }) };
            })
        }))
    }));
    return { revision: revision('revision'), sourceRevision: revision('source_revision'), groups };
}
