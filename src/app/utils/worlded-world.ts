export interface WorldedLot {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  map: string;
}

export type WorldedZoneGeometry = 'rectangle' | 'point' | 'polygon' | 'polyline';

/** A WorldEd cell object (zone) in cell tile coordinates, with its resolved display colour. */
export interface WorldedZone {
  name: string;
  group: string;
  type: string;
  color: string;
  level: number;
  geometry: WorldedZoneGeometry;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Absolute tile points for point, polygon and polyline zones. */
  points: [number, number][];
}

export interface WorldedObjectGroup { name: string; color: string; }

export interface WorldedCell {
  x: number;
  y: number;
  map: string;
  lots: WorldedLot[];
  /** Zones in WorldEd drawing order: level, then object group, then file order. */
  zones: WorldedZone[];
  objectCount: number;
  featureCount: number;
}

export interface WorldedBitmap {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldedWorld {
  width: number;
  height: number;
  cellSize: 300 | 256;
  cells: Map<string, WorldedCell>;
  bitmaps: WorldedBitmap[];
  objectGroups: WorldedObjectGroup[];
  lotCount: number;
  objectCount: number;
  warnings: string[];
}

const MAX_WORLD_DIMENSION = 1000;
const MAX_XML_CHARACTERS = 32 * 1024 * 1024;
const MAX_COORDINATE = 1_000_000;

function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(child => child.tagName === name);
}

function integer(element: Element, name: string, min: number, max: number, fallback?: number): number {
  const raw = element.getAttribute(name);
  if (raw === null && fallback !== undefined) return fallback;
  const value = raw?.trim() ?? '';
  const number = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Invalid ${name} on <${element.tagName}>: ${raw ?? '(missing)'}.`);
  }
  return number;
}

export function worldedCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** WorldEd's WorldObjectGroup::defaultColor() (Qt::darkGray), used for ungrouped and uncoloured groups. */
export const WORLDED_DEFAULT_ZONE_COLOR = '#808080';
const MIN_ZONE_LEVEL = -32;
const MAX_ZONE_LEVEL = 31;

/** Accepts the Qt colour names WorldEd writes: #rgb, #rrggbb and #aarrggbb. */
export function worldedColor(value: string | null | undefined, fallback: string): string {
  const color = value?.trim() ?? '';
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color.toLowerCase() : fallback;
}

function readZone(element: Element, groups: Map<string, { color: string; index: number }>):
    { zone: WorldedZone; order: number } | string {
  const group = element.getAttribute('group') ?? '';
  const known = groups.get(group);
  const rawLevel = Number(element.getAttribute('level') ?? '0');
  if (!Number.isFinite(rawLevel)) return 'invalid level';
  const level = Math.max(MIN_ZONE_LEVEL, Math.min(MAX_ZONE_LEVEL, Math.trunc(rawLevel)));
  const base = {
    name: element.getAttribute('name') ?? '', group, type: element.getAttribute('type') ?? '',
    color: known?.color ?? WORLDED_DEFAULT_ZONE_COLOR, level,
  };
  const order = group ? known?.index ?? 0 : 0;
  const geometry = element.getAttribute('geometry');
  if (geometry !== null) {
    if (geometry !== 'point' && geometry !== 'polygon' && geometry !== 'polyline') return `unknown geometry "${geometry}"`;
    const points: [number, number][] = [];
    for (const match of (element.getAttribute('points') ?? '').matchAll(/(-?\d+)\s*,\s*(-?\d+)/g)) {
      const x = Number(match[1]), y = Number(match[2]);
      if (Math.abs(x) > MAX_COORDINATE || Math.abs(y) > MAX_COORDINATE) return 'point out of range';
      points.push([x, y]);
    }
    const minimum = geometry === 'point' ? 1 : geometry === 'polyline' ? 2 : 3;
    if (points.length < minimum) return `${geometry} has too few points`;
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { order, zone: { ...base, geometry, points, x, y,
      width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 } };
  }
  const value = (name: string, min: number) => {
    const number = Number(element.getAttribute(name) ?? '0');
    return Number.isFinite(number) && number >= min && number <= MAX_COORDINATE ? number : undefined;
  };
  const x = value('x', -MAX_COORDINATE), y = value('y', -MAX_COORDINATE);
  const width = value('width', 0), height = value('height', 0);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return 'invalid bounds';
  return { order, zone: { ...base, geometry: 'rectangle', points: [], x, y, width, height } };
}

export function readWorldedWorld(xml: string): WorldedWorld {
  if (xml.length > MAX_XML_CHARACTERS) throw new Error('The world file is too large to open.');
  if (/<!DOCTYPE\b/i.test(xml)) throw new Error('World files containing a document type are not supported.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  if (root.tagName === 'parsererror' || document.querySelector('parsererror')) {
    throw new Error('The world file is not valid XML.');
  }
  if (root.tagName !== 'world') throw new Error('This file is not a WorldEd world.');
  const version = root.getAttribute('version');
  if (version && version !== '1.0') throw new Error(`Unsupported world version: ${version}.`);
  const format = root.getAttribute('cellFormat') ?? '';
  if (format && format !== 'legacy-300' && format !== 'native-256') {
    throw new Error(`Unsupported world cell format: ${format}.`);
  }

  const width = integer(root, 'width', 1, MAX_WORLD_DIMENSION);
  const height = integer(root, 'height', 1, MAX_WORLD_DIMENSION);
  const world: WorldedWorld = {
    width, height, cellSize: format === 'native-256' ? 256 : 300,
    cells: new Map(), bitmaps: [], objectGroups: [], lotCount: 0, objectCount: 0, warnings: [],
  };
  let features = 0;
  let unknownLotSizes = 0;
  let invalidZones = 0;
  const unsupportedCellElements = new Set<string>();
  // WorldEd's nameless null group is index 0; named groups follow in file order.
  const groups = new Map<string, { color: string; index: number }>();
  for (const element of children(root, 'objectgroup')) {
    const name = element.getAttribute('name') ?? '';
    if (!name || groups.has(name)) continue;
    const color = worldedColor(element.getAttribute('color'), WORLDED_DEFAULT_ZONE_COLOR);
    groups.set(name, { color, index: groups.size + 1 });
    world.objectGroups.push({ name, color });
  }

  for (const element of children(root, 'cell')) {
    const x = integer(element, 'x', 0, width - 1);
    const y = integer(element, 'y', 0, height - 1);
    const key = worldedCellKey(x, y);
    if (world.cells.has(key)) throw new Error(`The world contains duplicate cell ${x}, ${y}.`);
    const lots = children(element, 'lot').map(lot => ({
      x: integer(lot, 'x', -MAX_COORDINATE, MAX_COORDINATE, 0),
      y: integer(lot, 'y', -MAX_COORDINATE, MAX_COORDINATE, 0),
      width: integer(lot, 'width', 0, MAX_COORDINATE, 0),
      height: integer(lot, 'height', 0, MAX_COORDINATE, 0),
      level: integer(lot, 'level', -32, 31, 0),
      map: lot.getAttribute('map') ?? '',
    }));
    const objects = children(element, 'object');
    const ordered: { zone: WorldedZone; order: number; index: number }[] = [];
    objects.forEach((object, index) => {
      const read = readZone(object, groups);
      if (typeof read === 'string') invalidZones++;
      else ordered.push({ ...read, index });
    });
    const zones = ordered.sort((a, b) => a.zone.level - b.zone.level || a.order - b.order || a.index - b.index)
      .map(item => item.zone);
    const objectCount = objects.length;
    const featureCount = children(element, 'feature').length;
    world.cells.set(key, { x, y, map: element.getAttribute('map') ?? '', lots, zones, objectCount, featureCount });
    world.lotCount += lots.length;
    world.objectCount += objectCount;
    features += featureCount;
    unknownLotSizes += lots.filter(lot => !lot.width || !lot.height).length;
    for (const child of Array.from(element.children)) {
      if (!['lot', 'object', 'feature', 'template', 'property'].includes(child.tagName)) {
        unsupportedCellElements.add(child.tagName);
      }
    }
  }

  for (const element of children(root, 'bmp')) {
    const path = element.getAttribute('path') ?? '';
    if (!path.trim()) throw new Error('A world terrain image is missing its path.');
    world.bitmaps.push({
      path,
      x: integer(element, 'x', -MAX_COORDINATE, MAX_COORDINATE),
      y: integer(element, 'y', -MAX_COORDINATE, MAX_COORDINATE),
      width: integer(element, 'width', 1, MAX_WORLD_DIMENSION),
      height: integer(element, 'height', 1, MAX_WORLD_DIMENSION),
    });
  }

  if (unknownLotSizes) world.warnings.push(`${unknownLotSizes} building lots have no dimensions and cannot be drawn as footprints.`);
  if (invalidZones) world.warnings.push(`${invalidZones} zone object${invalidZones === 1 ? ' has' : 's have'} invalid geometry and will not be shown in TileZed.`);
  if (world.objectCount) world.warnings.push('Zones are not drawn in this overview; open a cell in TileZed to see them.');
  if (features) world.warnings.push('In-game map features are not drawn in this overview.');
  if (children(root, 'road').length) world.warnings.push('WorldEd road objects are not drawn in this overview.');
  if (children(root, 'otherworld').length) world.warnings.push('Linked other worlds are not included in this overview.');
  for (const name of unsupportedCellElements) world.warnings.push(`Unsupported cell data <${name}> is not shown.`);
  return world;
}
