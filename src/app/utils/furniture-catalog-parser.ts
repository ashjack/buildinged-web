import { BFurnitureGroup } from '../models/furniture-window.models';

interface Block { name: string; values: Record<string, string>; children: Block[]; }
/** Shared parser for native BuildingFurniture.txt; coordinates and orientation stay source-authored. */
export function parseFurnitureGroups(text: string): BFurnitureGroup[] {
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
    return root.children.filter(block => block.name === 'group').map(group => ({
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
}
