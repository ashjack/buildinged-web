import { TileEntry } from '../models/app.models';

/** One BuildingTiles.txt entry. Blank slots are omitted from `tiles`, zero offsets from `offsets`. */
export interface BuildingTilesEntry {
  tiles: Readonly<Record<string, string>>;
  offsets?: Readonly<Record<string, readonly [number, number]>>;
}
export interface BuildingTilesCategory { name: string; entries: BuildingTilesEntry[]; }
export interface BuildingTilesDocument { revision: number; sourceRevision?: number | null; categories: BuildingTilesCategory[]; }

export interface BuildingTilesCategoryDefinition {
  name: string;
  label: string;
  enums: readonly string[];
  /** BuildingTileEntry::displayTile's slot. */
  display: string;
  /** createEntryFromSingleTile: index offsets per slot for an eight-column sheet, or null to leave the slot blank. */
  single: readonly (number | null)[];
  /** Offsets createEntryFromSingleTile also assigns. */
  singleOffsets?: Readonly<Record<string, readonly [number, number]>>;
}

const range = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
const blanks = (count: number) => Array<null>(count).fill(null);
const WALL = ['West', 'North', 'NorthWest', 'SouthEast', 'WestWindow', 'NorthWindow', 'WestDoor', 'NorthDoor'];
const WALL_SINGLE = [0, 1, 2, 3, 8, 9, 10, 11];
const define = (name: string, label: string, enums: string[], single: (number | null)[], display = 'West',
  singleOffsets?: Record<string, [number, number]>): BuildingTilesCategoryDefinition =>
  ({ name, label, enums, single, display, singleOffsets });

/** The fixed categories of the desktop editor (buildingtiles.cpp), in the order its writeTxt uses. */
export const BUILDING_TILE_CATEGORIES: readonly BuildingTilesCategoryDefinition[] = [
  define('exterior_walls', 'Exterior Walls', WALL, WALL_SINGLE),
  define('interior_walls', 'Interior Walls', WALL, WALL_SINGLE),
  define('exterior_wall_trim', 'Trim - Exterior Walls', WALL, WALL_SINGLE),
  define('interior_wall_trim', 'Trim - Interior Walls', WALL, WALL_SINGLE),
  define('floors', 'Floors', ['Floor'], [0], 'Floor'),
  define('doors', 'Doors', ['West', 'North', 'WestOpen', 'NorthOpen'], [0, 1, 2, 3]),
  define('door_frames', 'Door Frames', ['West', 'North'], [0, 1]),
  define('windows', 'Windows', ['West', 'North'], [0, 1]),
  define('curtains', 'Curtains', ['West', 'East', 'North', 'South'], [0, 1, 2, 3]),
  define('shutters', 'Shutters', ['WestBelow', 'WestAbove', 'NorthLeft', 'NorthRight'], [0, 1, 2, 3], 'NorthLeft'),
  define('stairs', 'Stairs', [...range('West', 3), ...range('North', 3)], [0, 1, 2, 8, 9, 10], 'West1'),
  define('grime_floor', 'Grime - Floors', ['West', 'North', 'East', 'South', 'SouthWest', 'NorthWest', 'NorthEast', 'SouthEast'],
    [0, 1, 9, 8, 11, 2, 3, 10]),
  define('grime_wall', 'Grime - Walls', [...WALL, 'WestTrim', 'NorthTrim', 'NorthWestTrim', 'SouthEastTrim',
    'WestDoubleLeft', 'WestDoubleRight', 'NorthDoubleLeft', 'NorthDoubleRight'], [...WALL_SINGLE, ...blanks(8)]),
  define('roof_caps', 'Roof Caps', [...range('CapRiseE', 3), ...range('CapFallE', 3), ...range('CapRiseS', 3), ...range('CapFallS', 3),
    'PeakPt5S', 'PeakPt5E', 'PeakOnePt5S', 'PeakOnePt5E', 'PeakTwoPt5S', 'PeakTwoPt5E', ...range('CapGapS', 3), ...range('CapGapE', 3),
    'CapShallowRiseS1', 'CapShallowRiseS2', 'CapShallowFallS1', 'CapShallowFallS2',
    'CapShallowRiseE1', 'CapShallowRiseE2', 'CapShallowFallE1', 'CapShallowFallE2'],
  [0, 1, 2, 8, 9, 10, 13, 12, 11, 5, 4, 3, 7, 15, 6, 14, 17, 16, ...blanks(14)], 'CapRiseE3'),
  define('roof_slopes', 'Roof Slopes', [...range('SlopeS', 3), ...range('SlopeE', 3), 'SlopePt5S', 'SlopePt5E', 'SlopeOnePt5S', 'SlopeOnePt5E',
    'SlopeTwoPt5S', 'SlopeTwoPt5E', ...['W', 'E', 'N', 'S'].flatMap(side => range(`ShallowSlope${side}`, 2)),
    ...range('Inner', 3), ...range('Outer', 3), 'InnerPt5', 'InnerOnePt5', 'InnerTwoPt5', 'OuterPt5', 'OuterOnePt5', 'OuterTwoPt5',
    ...range('CornerSW', 3), ...range('CornerNE', 3)],
  [0, 1, 2, 5, 4, 3, 15, 14, 15, 14, 15, 14, ...blanks(8), 11, 12, 13, 8, 9, 10, ...blanks(6), 24, 25, 26, 29, 28, 27], 'SlopeS2',
  { SlopePt5S: [1, 1], SlopePt5E: [1, 1], SlopeTwoPt5S: [-1, -1], SlopeTwoPt5E: [-1, -1] }),
  define('roof_tops', 'Roof Tops', [...range('West', 3), ...range('North', 3)], [0, 0, 0, 0, 0, 0], 'West2',
    { West1: [-1, -1], West2: [-2, -2], North1: [-1, -1], North2: [-2, -2] }),
];

export function buildingTilesCategory(name: string): BuildingTilesCategoryDefinition | undefined {
  return BUILDING_TILE_CATEGORIES.find(category => category.name === name);
}

/** One cell of the desktop expert-mode grid: the slot it edits and which 64x128 cell of the template image sits behind it. */
export interface BuildingTilesCell { key: string | null; column: number; row: number; template: boolean; }
export interface BuildingTilesLayout { image: string; columns: number; rows: number; cells: BuildingTilesCell[]; }

const TEMPLATE_PATH = 'assets/building-tile-templates/';
const WALL_TEMPLATE = { image: 'shadow_walls.png', columns: 8, map: WALL };
/** Template image, its size in cells and its cell order, from buildingtiles.cpp setShadowImage and the shadowToEnum tables. */
const TEMPLATES: Readonly<Record<string, { image: string; columns: number; map: readonly (string | null)[] }>> = {
  exterior_walls: WALL_TEMPLATE,
  interior_walls: WALL_TEMPLATE,
  exterior_wall_trim: WALL_TEMPLATE,
  interior_wall_trim: WALL_TEMPLATE,
  floors: { image: 'shadow_floors.png', columns: 1, map: ['Floor'] },
  doors: { image: 'shadow_doors.png', columns: 4, map: ['West', 'North', 'WestOpen', 'NorthOpen'] },
  door_frames: { image: 'shadow_door_frames.png', columns: 2, map: ['West', 'North'] },
  windows: { image: 'shadow_windows.png', columns: 2, map: ['West', 'North'] },
  curtains: { image: 'shadow_curtains.png', columns: 4, map: ['West', 'East', 'North', 'South'] },
  shutters: { image: 'shadow_shutters.png', columns: 4, map: ['WestBelow', 'WestAbove', 'NorthLeft', 'NorthRight'] },
  stairs: { image: 'shadow_stairs.png', columns: 6, map: [...range('West', 3), ...range('North', 3)] },
  grime_floor: { image: 'shadow_grime_floor.png', columns: 8, map: ['West', 'North', 'East', 'South', 'SouthWest', 'NorthWest', 'NorthEast', 'SouthEast'] },
  grime_wall: {
    image: 'shadow_grime_wall.png', columns: 4, map: [...WALL, 'WestTrim', 'NorthTrim', 'NorthWestTrim', 'SouthEastTrim',
      'WestDoubleLeft', 'WestDoubleRight', 'NorthDoubleLeft', 'NorthDoubleRight'],
  },
  roof_caps: {
    image: 'shadow_roof_caps.png', columns: 6, map: [
      'CapRiseE1', 'CapRiseE2', 'CapRiseE3', 'CapFallS3', 'CapFallS2', 'CapFallS1',
      'CapFallE1', 'CapFallE2', 'CapFallE3', 'CapRiseS3', 'CapRiseS2', 'CapRiseS1',
      'PeakPt5E', 'PeakOnePt5E', 'PeakTwoPt5E', 'PeakTwoPt5S', 'PeakOnePt5S', 'PeakPt5S',
      'CapGapE1', 'CapGapE2', 'CapGapE3', 'CapGapS3', 'CapGapS2', 'CapGapS1',
      'CapShallowRiseE1', 'CapShallowRiseE2', null, null, 'CapShallowFallS2', 'CapShallowFallS1',
      'CapShallowFallE1', 'CapShallowFallE2', null, null, 'CapShallowRiseS2', 'CapShallowRiseS1',
    ],
  },
  roof_slopes: {
    image: 'shadow_roof_slopes.png', columns: 6, map: [
      'SlopeS1', 'SlopeS2', 'SlopeS3', 'SlopeE3', 'SlopeE2', 'SlopeE1',
      'SlopePt5S', 'SlopeOnePt5S', 'SlopeTwoPt5S', 'SlopeTwoPt5E', 'SlopeOnePt5E', 'SlopePt5E',
      'Outer1', 'Outer2', 'Outer3', 'Inner1', 'Inner2', 'Inner3',
      'OuterPt5', 'OuterOnePt5', 'OuterTwoPt5', 'InnerPt5', 'InnerOnePt5', 'InnerTwoPt5',
      'CornerSW1', 'CornerSW2', 'CornerSW3', 'CornerNE3', 'CornerNE2', 'CornerNE1',
      'ShallowSlopeW1', 'ShallowSlopeW2', null, null, 'ShallowSlopeE2', 'ShallowSlopeE1',
      'ShallowSlopeN1', 'ShallowSlopeN2', null, null, 'ShallowSlopeS2', 'ShallowSlopeS1',
    ],
  },
  roof_tops: { image: 'shadow_roof_tops.png', columns: 3, map: ['West3', 'West1', 'West2'] },
};

/**
 * The desktop expert-mode grid for a category. Gaps in the template stay as empty cells; slots the desktop
 * template leaves out (the North roof tops) follow as plain cells so they can still be edited.
 */
export function buildingTilesLayout(definition: BuildingTilesCategoryDefinition): BuildingTilesLayout {
  const template = TEMPLATES[definition.name];
  const map = template?.map ?? definition.enums;
  const columns = template?.columns ?? Math.min(8, definition.enums.length);
  const cells: BuildingTilesCell[] = map.map((key, i) => ({ key, column: i % columns, row: Math.floor(i / columns), template: !!template }));
  for (const key of definition.enums.filter(key => !map.includes(key))) {
    const i = cells.length;
    cells.push({ key, column: i % columns, row: Math.floor(i / columns), template: false });
  }
  return {
    image: template ? TEMPLATE_PATH + template.image : '',
    columns,
    rows: Math.ceil(map.length / columns),
    cells,
  };
}

/** Reads a desktop BuildingTiles.txt (SimpleFile format). Every known category is returned, in desktop order. */
export function parseBuildingTilesDocument(text: string): BuildingTilesDocument {
  const root: Block = { name: '', values: [], blocks: [] };
  const stack = [root];
  let pending = '';
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('{')) {
      // Accept both "name {" and "name" followed by "{" on the next line.
      const name = line.slice(0, -1).trim() || pending;
      const block: Block = { name, values: [], blocks: [] };
      stack[stack.length - 1].blocks.push(block);
      stack.push(block);
      pending = '';
      continue;
    }
    if (line === '}') {
      if (stack.length === 1) throw new Error('BuildingTiles.txt has an unmatched "}".');
      stack.pop();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) { pending = line; continue; }
    line = line.trim();
    stack[stack.length - 1].values.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
  }
  if (stack.length !== 1) throw new Error('BuildingTiles.txt has an unclosed block.');
  const value = (block: Block, key: string) => block.values.find(([name]) => name === key)?.[1];
  const version = Number(value(root, 'version'));
  if (version !== 2) throw new Error(`Expected BuildingTiles.txt version 2, got ${value(root, 'version') ?? 'none'}.`);

  const entries = new Map<string, BuildingTilesEntry[]>();
  for (const block of root.blocks) {
    if (block.name !== 'category') throw new Error(`Unknown block "${block.name}" in BuildingTiles.txt.`);
    const definition = buildingTilesCategory(value(block, 'name') ?? '');
    if (!definition) throw new Error(`Unknown category "${value(block, 'name')}" in BuildingTiles.txt.`);
    const list = entries.get(definition.name) ?? [];
    entries.set(definition.name, list);
    for (const entry of block.blocks) {
      if (entry.name !== 'entry') throw new Error(`Unknown block "${entry.name}" in BuildingTiles.txt.`);
      const tiles: Record<string, string> = {}, offsets: Record<string, [number, number]> = {};
      for (const [key, text] of entry.values) {
        if (key === 'offset') {
          const [name, x, y, ...rest] = text.split(/\s+/);
          if (!definition.enums.includes(name) || rest.length || !/^-?\d+$/.test(x ?? '') || !/^-?\d+$/.test(y ?? '')) {
            throw new Error(`Expected "offset = name x y" in ${definition.name}, got "${text}".`);
          }
          if (Number(x) || Number(y)) offsets[name] = [Number(x), Number(y)];
          continue;
        }
        if (!definition.enums.includes(key)) throw new Error(`Unknown ${definition.name} slot "${key}".`);
        if (text) tiles[key] = text;
      }
      list.push(Object.keys(offsets).length ? { tiles, offsets } : { tiles });
    }
  }
  const sourceRevision = value(root, 'source_revision');
  return {
    revision: Number(value(root, 'revision')) || 0,
    sourceRevision: sourceRevision === undefined ? null : Number(sourceRevision) || 0,
    categories: BUILDING_TILE_CATEGORIES.map(({ name }) => ({ name, entries: entries.get(name) ?? [] })),
  };
}
interface Block { name: string; values: [string, string][]; blocks: Block[]; }

/** Writes the desktop format (BuildingTilesMgr::writeTxt). The server writes the published file the same way. */
export function serializeBuildingTiles(document: BuildingTilesDocument): string {
  const lines = ['version = 2', `revision = ${document.revision}`];
  if (document.sourceRevision != null) lines.push(`source_revision = ${document.sourceRevision}`);
  for (const definition of BUILDING_TILE_CATEGORIES) {
    lines.push('category', '{', `    label = ${definition.label}`, `    name = ${definition.name}`);
    for (const entry of document.categories.find(category => category.name === definition.name)?.entries ?? []) {
      lines.push('    entry', '    {');
      for (const key of definition.enums) lines.push(`        ${key} = ${entry.tiles[key] ?? ''}`);
      for (const key of definition.enums) {
        const offset = entry.offsets?.[key];
        if (offset && (offset[0] || offset[1])) lines.push(`        offset = ${key} ${offset[0]} ${offset[1]}`);
      }
      lines.push('    }');
    }
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

/** The editor's material form: every slot in enum order, blank slots as ''. */
export function toTileEntries(document: BuildingTilesDocument): TileEntry[] {
  return document.categories.flatMap(category => {
    const definition = buildingTilesCategory(category.name);
    return definition ? category.entries.map(entry => ({
      category: category.name,
      tiles: definition.enums.map(key => {
        const offset = entry.offsets?.[key];
        return offset && (offset[0] || offset[1])
          ? { enum: key, tile: entry.tiles[key] ?? '', offset: `${offset[0]} ${offset[1]}` }
          : { enum: key, tile: entry.tiles[key] ?? '' };
      }),
    })) : [];
  });
}

export function entryDisplayTile(category: string, entry: BuildingTilesEntry): string {
  return entry.tiles[buildingTilesCategory(category)?.display ?? 'West'] ?? '';
}

/** Order-independent identity, used to skip duplicates like the desktop dialog. */
export function buildingTilesEntryKey(entry: BuildingTilesEntry): string {
  const keys = new Set([...Object.keys(entry.tiles), ...Object.keys(entry.offsets ?? {})]);
  return JSON.stringify([...keys].sort().map(key => [key, entry.tiles[key] ?? '', ...(entry.offsets?.[key] ?? [0, 0])])
    .filter(([, tile, x, y]) => tile || x || y));
}

/** BTC_*::createEntryFromSingleTile, remapping its eight-column offsets onto the sheet's real column count. */
export function entryFromSingleTile(category: string, tile: string, columns = 8): BuildingTilesEntry {
  const definition = buildingTilesCategory(category);
  const match = /^(.+)_(\d+)(?:\.png)?$/i.exec(tile);
  if (!definition || !match) throw new Error('Select a numbered tile.');
  const sheet = match[1], index = Number(match[2]);
  const tiles: Record<string, string> = {};
  definition.enums.forEach((key, i) => {
    const offset = definition.single[i];
    if (offset === null || offset === undefined) return;
    const remapped = offset > 0 ? Math.floor(offset / 8) * columns + offset % 8 : offset;
    tiles[key] = `${sheet}_${String(index + remapped).padStart(3, '0')}`;
  });
  return definition.singleOffsets ? { tiles, offsets: { ...definition.singleOffsets } } : { tiles };
}

export function setEntryTile(entry: BuildingTilesEntry, key: string, tile: string | null): BuildingTilesEntry {
  const name = tile?.replace(/\.png$/i, '') ?? '';
  if ((entry.tiles[key] ?? '') === name) return entry;
  const tiles = { ...entry.tiles };
  if (name) tiles[key] = name; else delete tiles[key];
  return { ...entry, tiles };
}

export function setEntryOffset(entry: BuildingTilesEntry, key: string, x: number, y: number): BuildingTilesEntry {
  const current = entry.offsets?.[key] ?? [0, 0];
  if (current[0] === x && current[1] === y) return entry;
  const offsets = { ...entry.offsets };
  if (x || y) offsets[key] = [x, y]; else delete offsets[key];
  return Object.keys(offsets).length ? { ...entry, offsets } : { tiles: entry.tiles };
}

export function updateCategoryEntries(document: BuildingTilesDocument, name: string,
  update: (entries: BuildingTilesEntry[]) => BuildingTilesEntry[]): BuildingTilesDocument {
  const index = document.categories.findIndex(category => category.name === name);
  if (index < 0) return document;
  const entries = update(document.categories[index].entries);
  if (entries === document.categories[index].entries) return document;
  const categories = document.categories.slice();
  categories[index] = { ...categories[index], entries };
  return { ...document, categories };
}
