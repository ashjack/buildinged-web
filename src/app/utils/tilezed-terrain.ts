import { parseTileName } from './sheet-atlas';
import { TilezedBlend, TilezedDirection, TilezedLayer, TilezedMap, TilezedRule, TilezedTileset, tilesetForGid } from './tilezed-map';
import { tilezedRandomGrid } from './tilezed-random';

export interface TilezedScene {
  map: TilezedMap;
  layers: TilezedLayer[];
  usedSheets: { tileset: TilezedTileset; maxIndex: number }[];
  warnings: string[];
}

interface PreparedRule {
  rule: TilezedRule;
  choices: number[];
  missing: string[];
}

interface PreparedBlend {
  blend: TilezedBlend;
  main: Set<number>;
  choices: number[];
  excluded: Set<number>;
  excludedLayers: { layer: TilezedLayer | undefined; gids: Set<number> }[];
}

const NORTH = 1;
const SOUTH = 2;
const EAST = 4;
const WEST = 8;

function directionMatches(direction: TilezedDirection, neighbors: number): boolean {
  switch (direction) {
    case 'n': return (neighbors & (NORTH | EAST | WEST)) === NORTH;
    case 's': return (neighbors & (SOUTH | EAST | WEST)) === SOUTH;
    case 'e': return (neighbors & (EAST | NORTH | SOUTH)) === EAST;
    case 'w': return (neighbors & (WEST | NORTH | SOUTH)) === WEST;
    case 'ne': return (neighbors & (NORTH | EAST)) === (NORTH | EAST);
    case 'nw': return (neighbors & (NORTH | WEST)) === (NORTH | WEST);
    case 'se': return (neighbors & (SOUTH | EAST)) === (SOUTH | EAST);
    case 'sw': return (neighbors & (SOUTH | WEST)) === (SOUTH | WEST);
  }
}

function tileResolver(map: TilezedMap): (name: string) => number[] {
  const sheets = new Map(map.tilesets.map(tileset => [tileset.name.toLowerCase(), tileset]));
  const cache = new Map<string, number[]>();
  const resolve = (name: string, stack: Set<string>): number[] => {
    if (!name || name === 'null') return [0];
    const cached = cache.get(name);
    if (cached) return cached;
    if (stack.has(name)) throw new Error(`BMP alias ${name} contains a cycle.`);
    const alias = map.aliases.get(name);
    if (alias) {
      stack.add(name);
      const tiles = alias.flatMap(item => resolve(item, stack));
      stack.delete(name);
      cache.set(name, tiles);
      return tiles;
    }
    const wholeSheet = sheets.get(name.toLowerCase());
    if (wholeSheet) {
      const tiles = Array.from({ length: wholeSheet.columns * wholeSheet.rows }, (_, index) => wholeSheet.firstGid + index);
      cache.set(name, tiles);
      return tiles;
    }
    const parsed = parseTileName(name);
    const sheet = parsed ? sheets.get(parsed.sheet.toLowerCase()) : undefined;
    const tiles = sheet && parsed && parsed.index < sheet.columns * sheet.rows ? [sheet.firstGid + parsed.index] : [];
    cache.set(name, tiles);
    return tiles;
  };
  return name => resolve(name, new Set());
}

function nearbyBitmapPixel(x: number, y: number, width: number, height: number,
                           ground: Uint32Array, vegetation: Uint32Array): boolean {
  for (let row = Math.max(0, y - 2); row <= Math.min(height - 1, y + 2); row++) {
    for (let column = Math.max(0, x - 2); column <= Math.min(width - 1, x + 2); column++) {
      const index = row * width + column;
      if (ground[index] || vegetation[index]) return true;
    }
  }
  return false;
}

function unknownColors(pixels: Uint32Array, rules: TilezedRule[], bitmap: number): string[] {
  const known = new Set(rules.filter(rule => rule.bitmap === bitmap).map(rule => rule.color));
  const counts = new Map<number, number>();
  for (const pixel of pixels) {
    if (pixel && !known.has(pixel)) counts.set(pixel, (counts.get(pixel) ?? 0) + 1);
  }
  const label = bitmap === 0 ? 'Ground' : 'Vegetation';
  return [...counts].map(([value, count]) =>
    `${label} BMP: ${count.toLocaleString()} pixels have no rule for #${value.toString(16).padStart(6, '0').toUpperCase()}.`);
}

/** Generates the embedded BMP rules and transition tiles without changing the source map. */
export function generateTilezedScene(map: TilezedMap): TilezedScene {
  const count = map.width * map.height;
  const ground = map.bitmaps.get(0)?.pixels ?? new Uint32Array(count);
  const vegetation = map.bitmaps.get(1)?.pixels ?? new Uint32Array(count);
  const layers = new Map(map.layers.map(layer => [layer.name, layer]));
  const nonemptyLayers = new Set(map.layers.filter(layer => layer.gids.some(gid => gid !== 0)).map(layer => layer.name));
  const generated = new Map<string, Uint32Array>();
  const warnings = [...map.warnings, ...unknownColors(ground, map.rules, 0), ...unknownColors(vegetation, map.rules, 1)];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const resolve = tileResolver(map);
  const byColor = [new Map<number, PreparedRule[]>(), new Map<number, PreparedRule[]>()];
  const floorRules = new Map<number, PreparedRule>();

  for (const rule of map.rules) {
    const missing = rule.choices.filter(choice => resolve(choice).length === 0);
    const prepared: PreparedRule = { rule, choices: rule.choices.flatMap(resolve), missing };
    const group = byColor[rule.bitmap].get(rule.color) ?? [];
    group.push(prepared);
    byColor[rule.bitmap].set(rule.color, group);
    if (rule.bitmap === 0 && rule.layer === '0_Floor') {
      for (const gid of prepared.choices) if (gid) floorRules.set(gid, prepared);
    }
    if (layers.has(rule.layer) && !generated.has(rule.layer)) generated.set(rule.layer, new Uint32Array(count));
  }

  const preparedBlends = new Map<string, PreparedBlend[]>();
  for (const blend of map.blends) {
    const main = resolve(blend.main);
    const choices = resolve(blend.tile);
    if (!main.length || !choices.length) {
      warn(`BMP blend for ${blend.layer} references unknown tiles: ${[!main.length ? blend.main : '', !choices.length ? blend.tile : ''].filter(Boolean).join(', ')}.`);
      continue;
    }
    if (!layers.has(blend.layer)) warn(`BMP blend targets missing layer ${blend.layer}.`);
    for (const exclusion of blend.excluded) {
      if (!resolve(exclusion).length) warn(`BMP blend for ${blend.layer} has an unknown exclusion: ${exclusion}.`);
    }
    for (const exclusion of blend.excludedLayers) {
      if (nonemptyLayers.has(exclusion.layer) && !resolve(exclusion.tile).length) {
        warn(`BMP blend for ${blend.layer} has an unknown exclusion: ${exclusion.tile} in ${exclusion.layer}.`);
      }
    }
    const prepared: PreparedBlend = {
      blend,
      main: new Set(main),
      choices,
      excluded: new Set(blend.excluded.flatMap(resolve)),
      excludedLayers: blend.excludedLayers.map(exclusion => ({
        layer: layers.get(exclusion.layer),
        gids: new Set(resolve(exclusion.tile)),
      })),
    };
    const group = preparedBlends.get(blend.layer) ?? [];
    group.push(prepared);
    preparedBlends.set(blend.layer, group);
    if (layers.has(blend.layer) && !generated.has(blend.layer)) generated.set(blend.layer, new Uint32Array(count));
  }

  const seeds = new Map<number, Uint32Array>();
  const randomFor = (bitmap: number): Uint32Array => {
    const seed = map.bitmaps.get(bitmap)?.seed ?? 0;
    let values = seeds.get(seed);
    if (!values) {
      values = tilezedRandomGrid(map.width, map.height, seed);
      seeds.set(seed, values);
    }
    return values;
  };
  const groundRandom = randomFor(0);
  const vegetationRandom = randomFor(1);
  const floor = generated.get('0_Floor');
  const originalFloor = layers.get('0_Floor')?.gids;
  const inferredFloor = new Uint32Array(count);

  const applyRule = (prepared: PreparedRule, index: number, random: number) => {
    const { rule, choices, missing } = prepared;
    if (missing.length) warn(`BMP rule for ${rule.layer} references unknown tiles: ${missing.join(', ')}.`);
    const target = generated.get(rule.layer);
    if (!target) {
      warn(`BMP rule targets missing layer ${rule.layer}.`);
      return;
    }
    if (!choices.length) {
      warn(`BMP rule for ${rule.layer} has no available tile choices.`);
      return;
    }
    target[index] = choices[random % choices.length];
  };

  for (let i = 0; i < count; i++) {
    let groundColor = ground[i];
    for (const rule of byColor[0].get(groundColor) ?? []) applyRule(rule, i, groundRandom[i]);
    if (!groundColor && originalFloor?.[i]) {
      const rule = floorRules.get(originalFloor[i]);
      if (rule?.choices.length) {
        inferredFloor[i] = rule.choices[groundRandom[i] % rule.choices.length];
        groundColor = rule.rule.color;
      }
    }
    if (vegetation[i]) {
      for (const rule of byColor[1].get(vegetation[i]) ?? []) {
        if (!rule.rule.condition || rule.rule.condition === groundColor) applyRule(rule, i, vegetationRandom[i]);
      }
    }
  }

  if (floor) {
    const neighborAt = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= map.width || y >= map.height ? 0 : (floor[y * map.width + x] || inferredFloor[y * map.width + x]);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = y * map.width + x;
        const current = floor[index] || (
          inferredFloor[index] && (map.blendEdgesEverywhere || nearbyBitmapPixel(x, y, map.width, map.height, ground, vegetation))
            ? inferredFloor[index] : 0);
        if (!current && !map.blendEdgesEverywhere) continue;
        const north = neighborAt(x, y - 1);
        const south = neighborAt(x, y + 1);
        const east = neighborAt(x + 1, y);
        const west = neighborAt(x - 1, y);
        for (const [layerName, blends] of preparedBlends) {
          let selected: PreparedBlend | undefined;
          for (const blend of blends) {
            if (blend.main.has(current) || blend.excluded.has(current)) continue;
            const mask = (blend.main.has(north) ? NORTH : 0) | (blend.main.has(south) ? SOUTH : 0) |
              (blend.main.has(east) ? EAST : 0) | (blend.main.has(west) ? WEST : 0);
            if (directionMatches(blend.blend.direction, mask)) selected = blend;
          }
          if (!selected || selected.excludedLayers.some(exclusion => exclusion.gids.has(exclusion.layer?.gids[index] ?? 0))) continue;
          const target = generated.get(layerName);
          if (!target) {
            warn(`BMP blend targets missing layer ${layerName}.`);
            continue;
          }
          target[index] = selected.choices[groundRandom[index] % selected.choices.length];
        }
      }
    }
  }

  const sceneLayers = map.layers.map(layer => {
    const additions = generated.get(layer.name);
    if (!additions) return layer;
    const gids = new Uint32Array(count);
    const noBlend = map.noBlend?.get(layer.name);
    for (let i = 0; i < count; i++) gids[i] = noBlend?.[i] ? layer.gids[i] : (additions[i] || layer.gids[i]);
    return { ...layer, gids };
  });
  const used = new Map<number, { tileset: TilezedTileset; maxIndex: number }>();
  const gidCache = new Map<number, TilezedTileset>();
  for (const layer of sceneLayers) {
    if (!layer.visible || !layer.opacity) continue;
    for (const gid of layer.gids) {
      if (!gid) continue;
      let tileset = gidCache.get(gid);
      if (!tileset) {
        tileset = tilesetForGid(map.tilesets, gid);
        if (!tileset) throw new Error(`Generated terrain references unknown tile ID ${gid}.`);
        gidCache.set(gid, tileset);
      }
      const existing = used.get(tileset.firstGid);
      if (existing) existing.maxIndex = Math.max(existing.maxIndex, gid - tileset.firstGid);
      else used.set(tileset.firstGid, { tileset, maxIndex: gid - tileset.firstGid });
    }
  }
  return { map, layers: sceneLayers, usedSheets: [...used.values()], warnings };
}
