import { TilezedBlend, TilezedDirection, TilezedMap, TilezedRule } from './tilezed-map';

export interface TerrainSettings {
  aliases: Map<string, string[]>; rules: TilezedRule[]; blends: TilezedBlend[]; blendEdgesEverywhere: boolean;
}
export function terrainSettings(map: TilezedMap): TerrainSettings {
  return { aliases: map.aliases, rules: map.rules, blends: map.blends, blendEdgesEverywhere: map.blendEdgesEverywhere };
}
const rgb = (color: number) => `${color >>> 16} ${(color >>> 8) & 255} ${color & 255}`;
function color(value: string): number {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error(`Invalid terrain colour: ${value}`);
  return (parts[0] << 16) | (parts[1] << 8) | parts[2];
}
function list(value: string): string[] { return value.split(/[\s,]+/).filter(Boolean); }

/** Native Rules.txt / Blends.txt SimpleFile blocks, including aliases and layer exclusions. */
export function readTerrainSettings(text: string, kind: 'rules' | 'blends', current: TerrainSettings): TerrainSettings {
  if (text.length > 8 * 1024 * 1024) throw new Error('Terrain settings file is too large.');
  const blocks: { name: string; values: Map<string, string> }[] = [];
  let pending = '', block: typeof blocks[number] | undefined;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => !line.trim().startsWith('//'));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let raw = lines[lineIndex];
    if (/=\s*\[/.test(raw)) {
      while (!raw.trimEnd().endsWith(']') && lineIndex + 1 < lines.length) raw += ' ' + lines[++lineIndex];
      if (!raw.trimEnd().endsWith(']')) throw new Error('Unclosed list in terrain settings.');
      raw = raw.replace(/(=\s*)\[/, '$1').replace(/\]\s*$/, '');
    }
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (line.endsWith('{')) {
      if (block) throw new Error('Terrain settings cannot contain nested blocks.');
      block = { name: line.slice(0, -1).trim() || pending, values: new Map() }; pending = ''; blocks.push(block);
    } else if (line === '}') {
      if (!block) throw new Error('Unmatched closing brace in terrain settings.');
      block = undefined;
    } else if (line.includes('=')) {
      const equal = line.indexOf('='), key = line.slice(0, equal).trim(), value = line.slice(equal + 1).trim();
      if (!block) { if (key !== 'version' || value !== '1') throw new Error('Expected terrain settings version 1.'); }
      else block.values.set(key, value);
    } else { if (pending) throw new Error('Missing opening brace in terrain settings.'); pending = line; }
  }
  if (block || pending) throw new Error('Unclosed block in terrain settings.');
  const aliases = new Map<string, string[]>(), rules: TilezedRule[] = [], blends: TilezedBlend[] = [];
  for (const entry of blocks) {
    const get = (key: string, fallback?: string): string => {
      const value = entry.values.get(key) ?? fallback;
      if (value === undefined || !value.trim()) throw new Error(`${entry.name} requires ${key}.`);
      return value;
    };
    const allowed = entry.name === 'alias' ? ['name', 'tiles'] : entry.name === 'rule' ? ['label', 'bitmap', 'color', 'tiles', 'condition', 'layer', 'obsolete'] : ['layer', 'mainTile', 'blendTile', 'dir', 'exclude', 'exclude2'];
    for (const key of entry.values.keys()) if (!allowed.includes(key)) throw new Error(`Unknown ${entry.name} attribute ${key}.`);
    if (kind === 'rules' && entry.name === 'alias') {
      const name = get('name'); if (aliases.has(name)) throw new Error(`Duplicate terrain alias ${name}.`);
      aliases.set(name, list(get('tiles')));
    } else if (kind === 'rules' && entry.name === 'rule') {
      const bitmap = Number(get('bitmap'));
      if (bitmap !== 0 && bitmap !== 1) throw new Error('Terrain bitmap must be 0 or 1.');
      rules.push({ bitmap, color: color(get('color')), condition: color(get('condition', '0 0 0')), layer: get('layer'), choices: list(get('tiles')),
        ...(entry.values.has('label') ? { label: get('label') } : {}) });
    } else if (kind === 'blends' && entry.name === 'blend') {
      const direction = get('dir').toLowerCase();
      if (!['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(direction)) throw new Error(`Unknown blend direction ${direction}.`);
      const pairs = list(entry.values.get('exclude2') ?? '');
      if (pairs.length % 2) throw new Error('Blend exclude2 requires tile,layer pairs.');
      blends.push({ layer: get('layer'), main: get('mainTile'), tile: get('blendTile'), direction: direction as TilezedDirection,
        excluded: list(entry.values.get('exclude') ?? ''), excludedLayers: Array.from({ length: pairs.length / 2 }, (_, i) => ({ tile: pairs[i * 2], layer: pairs[i * 2 + 1] })) });
    } else throw new Error(`Unknown ${kind} block ${entry.name}.`);
  }
  return { ...current, ...(kind === 'rules' ? { aliases, rules } : { blends }) };
}

export function writeTerrainSettings(settings: TerrainSettings, kind: 'rules' | 'blends'): string {
  const block = (name: string, values: Record<string, string>) => `${name}\n{\n${Object.entries(values).filter(([, value]) => value).map(([key, value]) => `    ${key} = ${value}`).join('\n')}\n}\n`;
  const entries = kind === 'rules' ? [
    ...[...settings.aliases].map(([name, tiles]) => block('alias', { name, tiles: tiles.join(' ') })),
    ...settings.rules.map(rule => block('rule', { ...(rule.label ? { label: rule.label } : {}), bitmap: String(rule.bitmap), color: rgb(rule.color), tiles: rule.choices.join(' '), layer: rule.layer,
      ...(rule.condition ? { condition: rgb(rule.condition) } : {}) })),
  ] : settings.blends.map(blend => block('blend', { layer: blend.layer, mainTile: blend.main, blendTile: blend.tile, dir: blend.direction,
    exclude: blend.excluded.join(' '), exclude2: blend.excludedLayers.flatMap(item => [item.tile, item.layer]).join(' ') }));
  return 'version = 1\n\n' + entries.join('\n');
}

export function writeTerrainSettingsXml(document: Document, settings: TerrainSettings): Element {
  const root = document.createElement('bmp-settings');
  const group = (name: string, entries: Record<string, string>[], tag: string) => {
    const element = document.createElement(name); root.appendChild(element);
    for (const values of entries) { const entry = document.createElement(tag); for (const [key, value] of Object.entries(values)) entry.setAttribute(key, value); element.appendChild(entry); }
  };
  group('aliases', [...settings.aliases].map(([name, tiles]) => ({ name, tiles: tiles.join(' ') })), 'alias');
  group('rules', settings.rules.map(rule => ({ bitmapIndex: String(rule.bitmap), color: rgb(rule.color), condition: rgb(rule.condition), targetLayer: rule.layer, tileChoices: rule.choices.join(' '), ...(rule.label ? { label: rule.label } : {}) })), 'rule');
  group('blends', settings.blends.map(blend => ({ targetLayer: blend.layer, mainTile: blend.main, blendTile: blend.tile, dir: blend.direction,
    ExclusionList: blend.excluded.join(' '), exclude2: blend.excludedLayers.flatMap(item => [item.tile, item.layer]).join(' ') })), 'blend');
  const edges = document.createElement('edges-everywhere'); edges.setAttribute('value', String(settings.blendEdgesEverywhere)); root.appendChild(edges);
  return root;
}
