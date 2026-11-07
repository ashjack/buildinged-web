import { WorldedLot } from './worlded-world';

export interface TilezedTileset {
  name: string;
  source: string;
  firstGid: number;
  tileWidth: number;
  tileHeight: number;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  rows: number;
}

export interface TilezedLayer {
  name: string;
  gids: Uint32Array;
  visible: boolean;
  opacity: number;
}

export interface TilezedBitmap {
  seed: number;
  pixels: Uint32Array;
}

export interface TilezedRule {
  bitmap: number;
  color: number;
  condition: number;
  layer: string;
  choices: string[];
}

export type TilezedDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface TilezedBlend {
  layer: string;
  main: string;
  tile: string;
  direction: TilezedDirection;
  excluded: string[];
  excludedLayers: { tile: string; layer: string }[];
}

export interface TilezedMap {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  tilesets: TilezedTileset[];
  layers: TilezedLayer[];
  bitmaps: Map<number, TilezedBitmap>;
  aliases: Map<string, string[]>;
  rules: TilezedRule[];
  blends: TilezedBlend[];
  blendEdgesEverywhere: boolean;
  warnings: string[];
  lots?: WorldedLot[];
}

const MAX_CELLS = 1_000_000;
const DIRECTIONS: TilezedDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(child => child.tagName === name);
}

function required(element: Element, name: string): string {
  const value = element.getAttribute(name);
  if (value === null || !value.trim()) throw new Error(`<${element.tagName}> is missing ${name}.`);
  return value;
}

function integer(value: string, label: string, min: number, max: number): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Invalid ${label}: ${value}.`);
  }
  return number;
}

function color(value: string, label: string): number {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) throw new Error(`Invalid ${label}: ${value}.`);
  const [red, green, blue] = parts.map(part => integer(part, label, 0, 255));
  return (red << 16) | (green << 8) | blue;
}

function words(value: string | null): string[] {
  return value?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function layerName(element: Element): { name: string; level: number } {
  const name = required(element, 'name');
  const explicitLevel = element.getAttribute('level');
  const prefixed = /^(\d+)_(.+)$/.exec(name);
  const level = explicitLevel === null
    ? (prefixed ? integer(prefixed[1], 'layer level', 0, 1000) : 0)
    : integer(explicitLevel, 'layer level', 0, 1000);
  return { name: `${level}_${prefixed ? prefixed[2] : name}`, level };
}

async function decodeBytes(text: string, compression: string, expected: number, label: string): Promise<Uint8Array> {
  let encoded: string;
  try {
    encoded = atob(text.replace(/\s+/g, ''));
  } catch {
    throw new Error(`${label} contains invalid base64 data.`);
  }
  const input = Uint8Array.from(encoded, character => character.charCodeAt(0));
  if (!compression) {
    if (input.length !== expected) throw new Error(`${label} has an incorrect data length.`);
    return input;
  }
  if (compression !== 'zlib' && compression !== 'gzip') {
    throw new Error(`${label} uses unsupported ${compression} compression.`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress TMX data. Use a current version of Chrome, Edge, Firefox or Safari.');
  }

  const output = new Uint8Array(expected);
  let offset = 0;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(compression === 'zlib' ? 'deflate' : 'gzip'));
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > expected) {
        await reader.cancel();
        throw new Error(`${label} has an incorrect data length.`);
      }
      output.set(value, offset);
      offset += value.length;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not decompress ${label}: ${message}`);
  } finally {
    reader.releaseLock();
  }
  if (offset !== expected) throw new Error(`${label} has an incorrect data length.`);
  return output;
}

async function decodeWords(text: string, compression: string, count: number, label: string): Promise<Uint32Array> {
  const bytes = await decodeBytes(text, compression, count * 4, label);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Uint32Array(count);
  for (let i = 0; i < count; i++) result[i] = data.getUint32(i * 4, true);
  return result;
}

function readTileset(element: Element): TilezedTileset {
  if (element.hasAttribute('source')) throw new Error('External TSX tilesets are not supported yet.');
  if (element.hasAttribute('spacing') || element.hasAttribute('margin') || children(element, 'tileoffset').length) {
    throw new Error('Tilesets with spacing, margins, or tile offsets are not supported yet.');
  }
  const image = children(element, 'image')[0];
  if (!image) throw new Error(`Tileset ${required(element, 'name')} has no sheet image.`);
  const name = required(element, 'name');
  const tileWidth = integer(required(element, 'tilewidth'), `${name} tile width`, 1, 4096);
  const tileHeight = integer(required(element, 'tileheight'), `${name} tile height`, 1, 4096);
  const width = integer(required(image, 'width'), `${name} image width`, 1, 65536);
  const height = integer(required(image, 'height'), `${name} image height`, 1, 65536);
  const columns = Math.floor(width / tileWidth);
  const rows = Math.floor(height / tileHeight);
  if (!columns || !rows) throw new Error(`Tileset ${name} does not contain a complete tile.`);
  return {
    name,
    source: required(image, 'source'),
    firstGid: integer(required(element, 'firstgid'), `${name} firstgid`, 1, 0x0fffffff),
    tileWidth,
    tileHeight,
    imageWidth: width,
    imageHeight: height,
    columns,
    rows,
  };
}

async function readLayer(element: Element, width: number, height: number, name: string): Promise<TilezedLayer> {
  if (integer(required(element, 'width'), `${name} width`, 1, MAX_CELLS) !== width ||
      integer(required(element, 'height'), `${name} height`, 1, MAX_CELLS) !== height) {
    throw new Error(`Layer ${name} does not match the map dimensions.`);
  }
  const data = children(element, 'data')[0];
  if (!data) throw new Error(`Layer ${name} has no tile data.`);
  const encoding = data.getAttribute('encoding');
  let gids: Uint32Array;
  if (encoding === 'base64') {
    gids = await decodeWords(data.textContent ?? '', data.getAttribute('compression') ?? '', width * height, `Layer ${name}`);
  } else if (encoding === 'csv' && !data.getAttribute('compression')) {
    const values = (data.textContent ?? '').trim().split(',').map(value => value.trim());
    if (values.length !== width * height) throw new Error(`Layer ${name} has an incorrect number of tiles.`);
    gids = Uint32Array.from(values, value => integer(value, `${name} tile ID`, 0, 0xffffffff));
  } else {
    throw new Error(`Layer ${name} uses an unsupported tile encoding.`);
  }
  if (gids.some(gid => (gid & 0xf0000000) !== 0)) throw new Error(`Flipped tiles in layer ${name} are not supported yet.`);
  const opacity = Number(element.getAttribute('opacity') ?? '1');
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`Invalid opacity in layer ${name}.`);
  return { name, gids, visible: element.getAttribute('visible') !== '0', opacity };
}

async function readBitmap(element: Element, count: number): Promise<TilezedBitmap> {
  const index = integer(required(element, 'index'), 'BMP image index', 0, 1);
  const seed = integer(element.getAttribute('seed') ?? '0', 'BMP seed', 0, 0xffffffff);
  const palette = children(element, 'color').map(entry => color(required(entry, 'rgb'), 'BMP palette color'));
  const data = children(element, 'pixels')[0];
  if (!data) throw new Error(`BMP image ${index} has no pixels.`);
  const indexes = await decodeWords(data.textContent ?? '', 'gzip', count, `BMP image ${index}`);
  const pixels = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const paletteIndex = indexes[i];
    if (paletteIndex > palette.length) throw new Error(`BMP image ${index} has an invalid palette index.`);
    pixels[i] = paletteIndex ? palette[paletteIndex - 1] : 0;
  }
  return { seed, pixels };
}

function readSettings(map: TilezedMap, element: Element): void {
  const aliasGroup = children(element, 'aliases')[0];
  for (const entry of aliasGroup ? children(aliasGroup, 'alias') : []) {
    const name = required(entry, 'name');
    if (map.aliases.has(name)) throw new Error(`Duplicate BMP alias ${name}.`);
    map.aliases.set(name, words(entry.getAttribute('tiles')));
  }

  const ruleGroup = children(element, 'rules')[0];
  for (const entry of ruleGroup ? children(ruleGroup, 'rule') : []) {
    map.rules.push({
      bitmap: integer(required(entry, 'bitmapIndex'), 'BMP rule image index', 0, 1),
      color: color(required(entry, 'color'), 'BMP rule color'),
      condition: color(entry.getAttribute('condition') ?? '0 0 0', 'BMP rule condition'),
      layer: required(entry, 'targetLayer'),
      choices: words(entry.getAttribute('tileChoices')),
    });
  }

  const blendGroup = children(element, 'blends')[0];
  for (const entry of blendGroup ? children(blendGroup, 'blend') : []) {
    const direction = required(entry, 'dir');
    if (!DIRECTIONS.includes(direction as TilezedDirection)) throw new Error(`Unsupported BMP blend direction: ${direction}.`);
    const exclusions = words(entry.getAttribute('exclude2'));
    if (exclusions.length % 2) throw new Error('A BMP blend has an incomplete layer exclusion.');
    const excludedLayers: { tile: string; layer: string }[] = [];
    for (let i = 0; i < exclusions.length; i += 2) excludedLayers.push({ tile: exclusions[i], layer: exclusions[i + 1] });
    map.blends.push({
      layer: required(entry, 'targetLayer'),
      main: required(entry, 'mainTile'),
      tile: required(entry, 'blendTile'),
      direction: direction as TilezedDirection,
      excluded: words(entry.getAttribute('ExclusionList')),
      excludedLayers,
    });
  }
  map.blendEdgesEverywhere = children(element, 'edges-everywhere')[0]?.getAttribute('value') === 'true';
}

export function tilesetForGid(tilesets: TilezedTileset[], gid: number): TilezedTileset | undefined {
  let low = 0;
  let high = tilesets.length - 1;
  let match: TilezedTileset | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (tilesets[middle].firstGid <= gid) {
      match = tilesets[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match && gid - match.firstGid < match.columns * match.rows ? match : undefined;
}

/** Reads the standalone, finite TileZed maps supported by the read-only viewer. */
export async function readTilezedMap(xml: string): Promise<TilezedMap> {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const root = document.documentElement;
  if (root.tagName === 'parsererror' || document.querySelector('parsererror')) throw new Error('The TMX file is not valid XML.');
  if (root.tagName !== 'map') throw new Error('This file is not a TMX map.');
  if (root.getAttribute('orientation') !== 'levelisometric') throw new Error('Only TileZed level-isometric maps are supported.');
  const width = integer(required(root, 'width'), 'map width', 1, MAX_CELLS);
  const height = integer(required(root, 'height'), 'map height', 1, MAX_CELLS);
  if (width * height > MAX_CELLS) throw new Error(`Maps larger than ${MAX_CELLS.toLocaleString()} cells are not supported.`);
  const map: TilezedMap = {
    width,
    height,
    tileWidth: integer(required(root, 'tilewidth'), 'map tile width', 1, 4096),
    tileHeight: integer(required(root, 'tileheight'), 'map tile height', 1, 4096),
    tilesets: children(root, 'tileset').map(readTileset).sort((a, b) => a.firstGid - b.firstGid),
    layers: [],
    bitmaps: new Map(),
    aliases: new Map(),
    rules: [],
    blends: [],
    blendEdgesEverywhere: false,
    warnings: [],
    lots: [],
  };
  for (let i = 1; i < map.tilesets.length; i++) {
    const previous = map.tilesets[i - 1];
    if (previous.firstGid + previous.columns * previous.rows > map.tilesets[i].firstGid) {
      throw new Error(`Tilesets ${previous.name} and ${map.tilesets[i].name} have overlapping tile IDs.`);
    }
  }
  for (const layer of children(root, 'layer')) {
    const { name, level } = layerName(layer);
    if (level !== 0) {
      if (!map.warnings.includes('Only ground-level layers are shown.')) map.warnings.push('Only ground-level layers are shown.');
      continue;
    }
    if (map.layers.some(existing => existing.name === name)) throw new Error(`Duplicate layer ${name}.`);
    map.layers.push(await readLayer(layer, width, height, name));
  }
  if (!map.layers.length) throw new Error('The map has no ground-level tile layers.');
  for (const layer of map.layers) {
    for (const gid of layer.gids) {
      if (gid && !tilesetForGid(map.tilesets, gid)) throw new Error(`Layer ${layer.name} references an unknown tile ID ${gid}.`);
    }
  }
  for (const image of children(root, 'bmp-image')) {
    const index = integer(required(image, 'index'), 'BMP image index', 0, 1);
    if (map.bitmaps.has(index)) throw new Error(`Duplicate BMP image ${index}.`);
    map.bitmaps.set(index, await readBitmap(image, width * height));
  }
  const settings = children(root, 'bmp-settings')[0];
  if (settings) readSettings(map, settings);
  for (const group of children(root, 'objectgroup')) {
    const { level } = layerName(group);
    if (group.getAttribute('visible') === '0') continue;
    for (const object of children(group, 'object')) {
      if (object.getAttribute('name') !== 'lot' || object.getAttribute('visible') === '0') continue;
      let path = object.getAttribute('type') ?? '';
      if (!path) throw new Error('A TMX lot is missing its building path.');
      if (!/\.(tbx|tmx)$/i.test(path)) path += '.tmx';
      const value = (name: string) => {
        const raw = object.getAttribute(name) ?? '0', number = Number(raw);
        if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) throw new Error(`Invalid lot ${name}: ${raw}`);
        return number / map.tileHeight;
      };
      map.lots!.push({ x: value('x'), y: value('y'), width: value('width'), height: value('height'), level, map: path });
    }
  }
  if (children(root, 'objectgroup').some(group => children(group, 'object').some(object => object.getAttribute('name') !== 'lot')) ||
      children(root, 'imagelayer').length || children(root, 'group').length) {
    map.warnings.push('Non-lot objects, image layers, and layer groups are not shown in this viewer.');
  }
  return map;
}
