import { BEntry, BFurniture, BFurnitureGroup } from '../models/furniture-window.models';
import { FURNITURE_ORIENTS } from './furniture-catalog-parser';

export type FurnitureOrient = typeof FURNITURE_ORIENTS[number];
export const MAX_FURNITURE_COORD = 49;
export const BASIC_ORIENTS: readonly FurnitureOrient[] = ['W', 'N', 'E', 'S'];
export const CORNER_ORIENTS: readonly FurnitureOrient[] = ['SW', 'NW', 'NE', 'SE'];

/*
 * Immutable edits mirroring the desktop BuildingTilesDialog. Every helper returns new objects only along the
 * changed path, so undo snapshots share everything else.
 */

export function coords(pos: string): { x: number; y: number } {
  const [x, y] = pos.split(',').map(value => Number.parseInt(value, 10));
  return { x, y };
}

export function entryOf(furniture: BFurniture, orient: string): BEntry | undefined {
  return furniture.entries.find(entry => entry.orient === orient);
}

/** Grid size of an orientation: like the desktop editor it grows to the furthest tile and is at least 1x1. */
export function entrySize(entry: BEntry | undefined): { width: number; height: number } {
  let width = 1, height = 1;
  for (const item of entry?.items ?? []) {
    const { x, y } = coords(item.pos);
    width = Math.max(width, x + 1); height = Math.max(height, y + 1);
  }
  return { width, height };
}

export function tileAt(entry: BEntry | undefined, x: number, y: number): string | undefined {
  return entry?.items.find(item => { const c = coords(item.pos); return c.x === x && c.y === y; })?.tile;
}

export function orientsOf(furniture: BFurniture): readonly FurnitureOrient[] {
  return furniture.corners ? [...BASIC_ORIENTS, ...CORNER_ORIENTS] : BASIC_ORIENTS;
}

function withEntry(furniture: BFurniture, orient: string, update: (entry: BEntry) => BEntry): BFurniture {
  const index = furniture.entries.findIndex(entry => entry.orient === orient);
  const next = update(index >= 0 ? furniture.entries[index] : { orient, items: [] });
  const entries = index >= 0 ? furniture.entries.map((entry, i) => i === index ? next : entry) : [...furniture.entries, next];
  entries.sort((a, b) => FURNITURE_ORIENTS.indexOf(a.orient as FurnitureOrient) - FURNITURE_ORIENTS.indexOf(b.orient as FurnitureOrient));
  return { ...furniture, entries };
}

/** Sets or clears one square. Clearing the last row or column shrinks the grid back to the remaining tiles. */
export function setTile(furniture: BFurniture, orient: string, x: number, y: number, tile: string | null): BFurniture {
  if (x < 0 || y < 0 || x > MAX_FURNITURE_COORD || y > MAX_FURNITURE_COORD) return furniture;
  if ((tileAt(entryOf(furniture, orient), x, y) ?? null) === tile) return furniture;
  return withEntry(furniture, orient, entry => {
    const items = entry.items.filter(item => { const c = coords(item.pos); return c.x !== x || c.y !== y; });
    if (tile) items.push({ pos: `${x},${y}`, tile });
    return { ...entry, items };
  });
}

/**
 * Drops several tiles starting at (x, y). As in the desktop editor, they run along the wall the orientation
 * faces: down the y axis for W/E and along the x axis otherwise.
 */
export function dropTiles(furniture: BFurniture, orient: string, x: number, y: number, tiles: string[]): BFurniture {
  const size = entrySize(entryOf(furniture, orient));
  if (x < 0 || y < 0 || x > size.width || y > size.height) return furniture;
  const dx = orient === 'W' || orient === 'E' ? 0 : 1;
  const dy = orient === 'N' || orient === 'S' ? 0 : 1;
  let next = furniture;
  tiles.forEach((tile, i) => next = setTile(next, orient, x + dx * i, y + dy * i, tile));
  return next;
}

/** Tile number offsets from W for N, E and S, keyed by the button label. */
export const SEQUENCES = {
  '+2': [1],
  '+4': [1, 2, 3],
  '+1.5': [-1],
  '+3.5': [-1, 2, 1],
} as const satisfies Record<string, readonly number[]>;
export type SequenceName = keyof typeof SEQUENCES;

/**
 * Fills the orientations after W from its tiles by stepping through the sheet. For example `+4` on W `x_000`
 * gives N `x_001`, E `x_002`, S `x_003`, and `+3.5` on W `x_001` gives N `x_000`, E `x_003`, S `x_002`.
 * Each tile keeps its position, the filled orientations are replaced, and nothing changes if any step would
 * leave the 0–9999 range.
 */
export function fillSequential(furniture: BFurniture, offsets: readonly number[]): BFurniture {
  const base = entryOf(furniture, 'W')?.items ?? [];
  const parsed = base.map(item => /^(.+)_(\d{1,4})$/.exec(item.tile));
  if (!base.length || parsed.some(match => !match)) return furniture;
  let next = furniture;
  for (const [i, offset] of offsets.entries()) {
    const items: BEntry['items'] = [];
    for (const [j, item] of base.entries()) {
      const [, sheet, digits] = parsed[j]!;
      const index = Number(digits) + offset;
      if (index < 0 || index > 9999) return furniture;
      items.push({ pos: item.pos, tile: `${sheet}_${String(index).padStart(digits.length, '0')}` });
    }
    next = withEntry(next, BASIC_ORIENTS[i + 1], entry => ({ ...entry, items }));
  }
  return next;
}

export const SHIFT_STEPS = [-4, -2, -1, 1, 2, 4] as const;

/** Alphabetically ordered tileset names and their grid sizes. */
export interface SheetCatalog {
  names: readonly string[];
  size: (sheet: string) => number | undefined;
}

/** Steps a tile index by `offset`, carrying across the alphabetically sorted tileset list when known. */
function stepTile(sheet: string, index: number, offset: number, catalog?: SheetCatalog): { sheet: string; index: number } | null {
  index += offset;
  let sheetIndex = catalog?.names.indexOf(sheet) ?? -1;
  let size = catalog?.size(sheet);
  if (!catalog || sheetIndex < 0 || !size) return index >= 0 && index <= 9999 ? { sheet, index } : null;
  for (let guard = 0; guard < catalog.names.length && (index < 0 || index >= size); guard++) {
    if (index >= size) {
      if (++sheetIndex >= catalog.names.length) return null;
      index -= size;
      sheet = catalog.names[sheetIndex];
      size = catalog.size(sheet);
      if (!size) return null;
    } else {
      if (--sheetIndex < 0) return null;
      sheet = catalog.names[sheetIndex];
      size = catalog.size(sheet);
      if (!size) return null;
      index += size;
    }
  }
  return index >= 0 && index < size && index <= 9999 ? { sheet, index } : null;
}

/**
 * Moves every tile of every orientation along its sheet by `offset`, keeping positions and zero padding. With
 * `catalog`, tiles that run past the end (or start) of their sheet continue in the next (or previous)
 * alphabetically listed tileset. Nothing changes if any tile name has no index or has nowhere to go.
 */
export function shiftTiles(furniture: BFurniture, offset: number, catalog?: SheetCatalog): BFurniture {
  if (!offset || !furniture.entries.some(entry => entry.items.length)) return furniture;
  const entries: BEntry[] = [];
  for (const entry of furniture.entries) {
    const items: BEntry['items'] = [];
    for (const item of entry.items) {
      const match = /^(.+)_(\d{1,4})$/.exec(item.tile);
      const next = match && stepTile(match[1], Number(match[2]), offset, catalog);
      if (!match || !next) return furniture;
      items.push({ pos: item.pos, tile: `${next.sheet}_${String(next.index).padStart(match[2].length, '0')}` });
    }
    entries.push({ ...entry, items });
  }
  return { ...furniture, entries };
}

export function clearEntry(furniture: BFurniture, orient: string): BFurniture {
  return entryOf(furniture, orient)?.items.length ? withEntry(furniture, orient, entry => ({ ...entry, items: [] })) : furniture;
}

export function setGrime(furniture: BFurniture, orient: string, grime: boolean): BFurniture {
  return (entryOf(furniture, orient)?.grime !== false) === grime ? furniture : withEntry(furniture, orient, entry => ({ ...entry, grime }));
}

export function setLayer(furniture: BFurniture, layer: string): BFurniture {
  return (furniture.layer || 'Furniture') === layer ? furniture : { ...furniture, layer };
}

export function toggleCorners(furniture: BFurniture): BFurniture {
  return { ...furniture, corners: !furniture.corners };
}

export function updateFurniture(groups: BFurnitureGroup[], group: number, index: number,
  update: (furniture: BFurniture) => BFurniture): BFurnitureGroup[] {
  const current = groups[group]?.furniture[index];
  if (!current) return groups;
  const next = update(current);
  if (next === current) return groups;
  return groups.map((g, i) => i === group ? { ...g, furniture: g.furniture.map((f, j) => j === index ? next : f) } : g);
}

export function updateGroup(groups: BFurnitureGroup[], group: number, update: (group: BFurnitureGroup) => BFurnitureGroup): BFurnitureGroup[] {
  const current = groups[group];
  if (!current) return groups;
  const next = update(current);
  return next === current ? groups : groups.map((g, i) => i === group ? next : g);
}

export function insertAt<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

export function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Labels end up on a "label = ..." line, so they must not contain line breaks, braces or comment markers. */
export function validCategoryLabel(label: string): boolean {
  const text = label.trim();
  return !!text && text.length <= 100 && !/[\u0000-\u001f\u007f{}]|\/\//.test(text);
}
