export interface WorldedLot {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  map: string;
}

export interface WorldedCell {
  x: number;
  y: number;
  map: string;
  lots: WorldedLot[];
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
    cells: new Map(), bitmaps: [], lotCount: 0, objectCount: 0, warnings: [],
  };
  let features = 0;
  let unknownLotSizes = 0;
  const unsupportedCellElements = new Set<string>();

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
    const objectCount = children(element, 'object').length;
    const featureCount = children(element, 'feature').length;
    world.cells.set(key, { x, y, map: element.getAttribute('map') ?? '', lots, objectCount, featureCount });
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
  if (world.objectCount) world.warnings.push('World objects and zones are not drawn in this overview.');
  if (features) world.warnings.push('In-game map features are not drawn in this overview.');
  if (children(root, 'road').length) world.warnings.push('WorldEd road objects are not drawn in this overview.');
  if (children(root, 'otherworld').length) world.warnings.push('Linked other worlds are not included in this overview.');
  for (const name of unsupportedCellElements) world.warnings.push(`Unsupported cell data <${name}> is not shown.`);
  return world;
}
