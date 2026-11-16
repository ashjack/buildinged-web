import { TilezedLayer, tilezedLayerName, tilesetForGid, tilezedAxisCount } from './tilezed-map';
import { generateTilezedScene, mergeTerrainRegions, terrainColorWarnings, TerrainRegion, tileResolver, TilezedScene, TilezedTerrainUpdater } from './tilezed-terrain';
import { TerrainSettings, terrainSettings, writeTerrainSettingsXml } from './tilezed-terrain-settings';
import { TilezedCamera, TilezedViewport } from './tilezed-renderer';
import { WorldedLot } from './worlded-world';

export type TilezedTool = 'pan' | 'stamp' | 'bucket' | 'eraser' | 'select' | 'pick' | 'fence' | 'building' | 'move-building' | 'terrain';
export interface TilePoint { x: number; y: number; }
export interface TileRectangle extends TilePoint { width: number; height: number; }
export interface TileStamp { width: number; height: number; gids: Uint32Array; }
export type TilezedHistoryChange = 'region' | 'selection' | 'layers' | 'lots' | 'settings';
interface Change { index: number; raw: number; visible: number; mask: number; next: number; }
interface Edit {
  layer: string; changes: Change[]; before: number; after: number;
  newLayer?: { index: number; raw: TilezedLayer; visible: TilezedLayer; mask: Uint8Array };
  movedLayer?: { from: number; to: number };
  lotChange?: { index: number; before?: WorldedLot; after?: WorldedLot };
  terrain?: TerrainChange[];
  settings?: { before: TerrainSettings; after: TerrainSettings };
  terrainSelection?: { before: Set<number>; after: Set<number> };
  terrainWarnings?: { before: string[]; after: string[] };
}
interface TerrainChange { kind: 'bitmap' | 'raw' | 'mask'; key: string; index: number; before: number; after: number; }

export function tilezedTilePositionAtPixel(map: { height: number; tileWidth: number; tileHeight: number },
                                  camera: TilezedCamera, viewport: TilezedViewport, x: number, y: number): TilePoint {
  const dx = (camera.x + (x - viewport.width / 2) / camera.zoom - map.height * map.tileWidth / 2) / (map.tileWidth / 2);
  const dy = (camera.y + (y - viewport.height / 2) / camera.zoom) / (map.tileHeight / 2);
  return { x: (dx + dy) / 2, y: (dy - dx) / 2 };
}

export function tilezedTileAtPixel(map: { height: number; tileWidth: number; tileHeight: number },
  camera: TilezedCamera, viewport: TilezedViewport, x: number, y: number): TilePoint {
  const point = tilezedTilePositionAtPixel(map, camera, viewport, x, y);
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
}

export function tileRectangle(a: TilePoint, b: TilePoint): TileRectangle {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x) + 1, height: Math.abs(b.y - a.y) + 1 };
}

function inside(point: TilePoint, rect: TileRectangle): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function tileLine(a: TilePoint, b: TilePoint): TilePoint[] {
  const points: TilePoint[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push({ x, y });
    if (x === b.x && y === b.y) break;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return points;
}

/** Owns tile and building placement edits. Persistence always requires an explicit Save. */
export class TilezedEditDocument {
  readonly scene: TilezedScene;
  readonly lots: WorldedLot[];
  private readonly origins = new Map<WorldedLot, { kind: 'map' | 'world' | 'new'; index: number }>();
  private readonly savedLotIndices = new Map<object, number>();
  get placedLots(): WorldedLot[] { return this.lots.filter(lot => this.origins.get(lot)?.kind === 'new'); }
  private savedLots: WorldedLot[] = [];
  get placementsDirty(): boolean { return this.lots.length !== this.savedLots.length || this.lots.some((lot, i) => lot !== this.savedLots[i]); }
  selection?: TileRectangle;
  terrainSelection = new Set<number>();
  private terrainSelectionBefore?: Set<number>;
  private readonly source: Document;
  private readonly touched = new Set<string>();
  private past: Edit[] = [];
  private future: Edit[] = [];
  private stroke?: { layer: string; changes: Map<number, Change> };
  private terrainStroke?: Map<string, TerrainChange>;
  private terrainWarningsBefore?: string[];
  private readonly touchedBitmaps = new Set<number>();
  private readonly terrainUpdater = new TilezedTerrainUpdater();
  private terrainDirty?: TerrainRegion;
  terrainRevision = 0;
  terrainRegion?: TerrainRegion;
  private settingsTouched = false;
  private state = 0;
  private nextState = 0;
  private savedState = 0;
  private readonly initialLayerCount: number;
  private readonly initialLayerNames: Set<string>;

  constructor(xml: string, scene: TilezedScene, worldLots?: readonly WorldedLot[]) {
    this.source = new DOMParser().parseFromString(xml, 'application/xml');
    this.lots = [...(worldLots ?? scene.map.lots ?? [])];
    this.lots.forEach((lot, index) => this.origins.set(lot, { kind: worldLots ? 'world' : 'map', index }));
    this.savedLots = this.lots.slice();
    if (worldLots) this.lots.forEach((lot, index) => this.savedLotIndices.set(this.origins.get(lot)!, index));
    this.initialLayerCount = Array.from(this.source.documentElement.children).filter(item => item.tagName === 'layer').length;
    this.initialLayerNames = new Set(scene.map.layers.map(layer => layer.name));
    this.scene = { ...scene, map: { ...scene.map, tilesets: scene.map.tilesets.slice(),
      bitmaps: new Map([...scene.map.bitmaps].map(([index, bitmap]) => [index, { seed: bitmap.seed, pixels: bitmap.pixels.slice() }])),
      layers: scene.map.layers.map(layer => ({ ...layer, gids: layer.gids.slice() })),
      noBlend: new Map([...(scene.map.noBlend ?? [])].map(([name, bits]) => [name, bits.slice()])) },
      layers: scene.layers.map(layer => ({ ...layer, gids: layer.gids.slice() })) };
  }

  get dirty(): boolean { return this.state !== this.savedState || !!this.stroke?.changes.size || !!this.terrainStroke?.size; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get canAddLayer(): boolean {
    const added = this.scene.map.layers.filter(layer => !this.initialLayerNames.has(layer.name)).length;
    return this.initialLayerCount + added < 256;
  }
  suggestedLayerName(): string {
    let number = this.scene.map.layers.length + 1;
    while (this.scene.map.layers.some(layer => layer.name === `0_Tile Layer ${number}`)) number++;
    return `Tile Layer ${number}`;
  }
  canMoveLayer(name: string, direction: 'up' | 'down'): boolean {
    const index = this.scene.map.layers.findIndex(layer => layer.name === name);
    return index >= 0 && (direction === 'up' ? index < this.scene.map.layers.length - 1 : index > 0);
  }
  /** Native MoveLayer raises toward the end of the draw stack; the picker is reversed. */
  moveLayer(name: string, direction: 'up' | 'down'): boolean {
    if (!this.canMoveLayer(name, direction)) return false;
    this.finish();
    const from = this.scene.map.layers.findIndex(layer => layer.name === name);
    const to = from + (direction === 'up' ? 1 : -1);
    this.reorderLayer(from, to);
    this.record({ layer: name, changes: [], movedLayer: { from, to } });
    return true;
  }
  private reorderLayer(from: number, to: number): void {
    this.scene.map.layers.splice(to, 0, this.scene.map.layers.splice(from, 1)[0]);
    this.scene.layers.splice(to, 0, this.scene.layers.splice(from, 1)[0]);
  }
  addLayer(value: string): string {
    const label = value.trim().replace(/^0_/, '');
    if (!label || /[\x00-\x1f]/.test(label)) throw new Error('Enter a layer name.');
    if (/^\d+_/.test(label)) throw new Error('New layers must be on the ground level (0).');
    const name = `0_${label}`;
    if (this.scene.map.layers.some(layer => layer.name === name)) throw new Error('A tile layer already has that name.');
    if (!this.canAddLayer) throw new Error('Maps can contain at most 256 tile layers.');
    this.finish();
    const count = this.scene.map.width * this.scene.map.height;
    const raw: TilezedLayer = { name, gids: new Uint32Array(count), visible: true, opacity: 1 };
    const visible = { ...raw, gids: new Uint32Array(count) }, mask = new Uint8Array(count);
    const newLayer = { index: this.scene.map.layers.length, raw, visible, mask };
    this.scene.map.layers.push(raw); this.scene.layers.push(visible);
    this.scene.map.noBlend!.set(name, mask); this.touched.add(name);
    this.record({ layer: name, changes: [], newLayer });
    return name;
  }
  markSaved(): void {
    this.finish(); this.savedState = this.state; this.savedLots = this.lots.slice();
    this.savedLotIndices.clear();
    this.lots.forEach((lot, index) => this.savedLotIndices.set(this.origins.get(lot)!, index));
  }
  worldLotsForSave(): (WorldedLot & { sourceIndex?: number })[] {
    return this.lots.map(lot => {
      const sourceIndex = this.savedLotIndices.get(this.origins.get(lot)!);
      return sourceIndex === undefined ? { ...lot } : { ...lot, sourceIndex };
    });
  }
  placeBuilding(lot: WorldedLot): void {
    if (![lot.x, lot.y, lot.width, lot.height, lot.level].every(Number.isSafeInteger) ||
      lot.width < 1 || lot.height < 1 || lot.level !== 0 || !/\.tbx$/i.test(lot.map)) throw new Error('Choose a valid ground-level building.');
    this.finish();
    const placement = { ...lot };
    this.origins.set(placement, { kind: 'new', index: -1 });
    this.lots.push(placement);
    this.record({ layer: '', changes: [], lotChange: { index: this.lots.length - 1, after: placement } });
  }
  moveBuilding(lot: WorldedLot, point: TilePoint): WorldedLot | undefined {
    const index = this.lots.indexOf(lot);
    if (index < 0 || ![point.x, point.y].every(Number.isSafeInteger) || Math.abs(point.x) > 1000000 || Math.abs(point.y) > 1000000) return undefined;
    if (point.x === lot.x && point.y === lot.y) return lot;
    this.finish();
    const moved = { ...lot, x: point.x, y: point.y };
    this.origins.set(moved, this.origins.get(lot)!);
    this.lots[index] = moved;
    this.record({ layer: '', changes: [], lotChange: { index, before: lot, after: moved } });
    return moved;
  }
  removeBuilding(lot: WorldedLot): boolean {
    const index = this.lots.indexOf(lot);
    if (index < 0) return false;
    this.finish(); this.lots.splice(index, 1);
    this.record({ layer: '', changes: [], lotChange: { index, before: lot } });
    return true;
  }
  contains(point: TilePoint): boolean {
    return inside(point, { x: 0, y: 0, width: this.scene.map.width, height: this.scene.map.height });
  }
  private drawable(point: TilePoint): boolean { return this.contains(point) && (!this.selection || inside(point, this.selection)); }
  private layer(name: string): TilezedLayer {
    const layer = this.scene.map.layers.find(layer => layer.name === name);
    if (!layer || !layer.visible || !layer.opacity) throw new Error('Choose a visible tile layer.');
    return layer;
  }
  begin(layer: string): void {
    this.finish();
    this.layer(layer);
    this.stroke = { layer, changes: new Map() };
  }
  private write(point: TilePoint, gid: number): void {
    if (!this.stroke || !this.drawable(point)) return;
    const map = this.scene.map;
    if (gid && !tilesetForGid(map.tilesets, gid)) throw new Error('Choose a tile from this map’s tilesets.');
    const layer = this.layer(this.stroke.layer);
    const visible = this.scene.layers.find(item => item.name === layer.name)!;
    const index = point.y * map.width + point.x;
    if (visible.gids[index] === gid) return;
    const mask = map.noBlend!.get(layer.name) ?? new Uint8Array(map.width * map.height);
    map.noBlend!.set(layer.name, mask);
    const change = this.stroke.changes.get(index) ?? { index, raw: layer.gids[index], visible: visible.gids[index], mask: mask[index], next: gid };
    change.next = gid;
    this.stroke.changes.set(index, change);
    layer.gids[index] = visible.gids[index] = gid;
    mask[index] = 1;
    this.touched.add(layer.name);
  }
  stamp(point: TilePoint, stamp: TileStamp): void {
    for (let y = 0; y < stamp.height; y++) for (let x = 0; x < stamp.width; x++) {
      const gid = stamp.gids[y * stamp.width + x];
      if (gid) this.write({ x: point.x + x, y: point.y + y }, gid);
    }
  }
  erase(point: TilePoint): void { this.write(point, 0); }
  paintCells(layer: string, cells: readonly { point: TilePoint; gid: number }[]): void {
    this.begin(layer);
    for (const cell of cells) this.write(cell.point, cell.gid);
    this.finish();
  }
  eraseSelection(layer: string): void {
    if (!this.selection) return;
    this.begin(layer);
    const rect = this.selection;
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) this.erase({ x, y });
    this.finish();
  }
  fill(layer: string, point: TilePoint, stamp: TileStamp, wholeSelection = false): void {
    if (!this.drawable(point) || !stamp.gids.some(gid => gid)) return;
    this.begin(layer);
    const map = this.scene.map;
    const visible = this.scene.layers.find(item => item.name === layer)!;
    const target = visible.gids[point.y * map.width + point.x];
    const region: number[] = [];
    if (wholeSelection) {
      const rect = this.selection ?? { x: 0, y: 0, width: map.width, height: map.height };
      for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) region.push(y * map.width + x);
    } else {
      const seen = new Uint8Array(map.width * map.height);
      const queue = [point.y * map.width + point.x];
      seen[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head], x = index % map.width, y = Math.floor(index / map.width);
        region.push(index);
        for (const next of [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }]) {
          if (!this.drawable(next)) continue;
          const ni = next.y * map.width + next.x;
          if (!seen[ni] && visible.gids[ni] === target) { seen[ni] = 1; queue.push(ni); }
        }
      }
    }
    let minX = map.width, minY = map.height;
    for (const index of region) { minX = Math.min(minX, index % map.width); minY = Math.min(minY, Math.floor(index / map.width)); }
    for (const index of region) {
      const x = index % map.width, y = Math.floor(index / map.width);
      const gid = stamp.gids[((y - minY) % stamp.height) * stamp.width + (x - minX) % stamp.width];
      if (gid) this.write({ x, y }, gid);
    }
    this.finish();
  }
  capture(layer: string, rect = this.selection): TileStamp | undefined {
    if (!rect) return undefined;
    const visible = this.scene.layers.find(item => item.name === layer);
    if (!visible) return undefined;
    const gids = new Uint32Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
      gids[y * rect.width + x] = visible.gids[(rect.y + y) * this.scene.map.width + rect.x + x];
    }
    return { width: rect.width, height: rect.height, gids };
  }
  beginTerrain(): void { this.finish(); this.terrainStroke = new Map(); this.terrainWarningsBefore = this.scene.warnings; }
  selectTerrain(selection: Set<number>): void {
    this.terrainSelectionBefore ??= new Set(this.terrainSelection);
    this.terrainSelection = new Set(selection);
  }
  changeTerrainSettings(after: TerrainSettings): void {
    this.finish();
    // Validate aliases and referenced tiles before changing the document.
    const generated = generateTilezedScene({ ...this.scene.map, ...after });
    const before = terrainSettings(this.scene.map);
    Object.assign(this.scene.map, after); this.settingsTouched = true;
    this.scene.layers = generated.layers; this.scene.usedSheets = generated.usedSheets; this.scene.warnings = generated.warnings;
    this.record({ layer: '', changes: [], settings: { before, after } });
  }
  private terrainArray(kind: TerrainChange['kind'], key: string): Uint32Array | Uint8Array {
    const map = this.scene.map, count = map.width * map.height;
    if (kind === 'bitmap') {
      const index = Number(key);
      if (!map.bitmaps.has(index)) map.bitmaps.set(index, { seed: 0, pixels: new Uint32Array(count) });
      this.touchedBitmaps.add(index);
      return map.bitmaps.get(index)!.pixels;
    }
    this.touched.add(key);
    if (kind === 'raw') return map.layers.find(layer => layer.name === key)!.gids;
    if (!map.noBlend!.has(key)) map.noBlend!.set(key, new Uint8Array(count));
    return map.noBlend!.get(key)!;
  }
  private terrainWrite(kind: TerrainChange['kind'], key: string, index: number, value: number): void {
    const array = this.terrainArray(kind, key);
    if (array[index] === value) return;
    const id = `${kind}:${key}:${index}`, old = this.terrainStroke!.get(id);
    this.terrainStroke!.set(id, { kind, key, index, before: old?.before ?? array[index], after: value });
    array[index] = value;
    this.terrainDirty = mergeTerrainRegions(this.terrainDirty, { x: index % this.scene.map.width, y: Math.floor(index / this.scene.map.width), width: 1, height: 1 });
  }
  paintTerrain(bitmap: number, cells: Iterable<number>, color: number): void {
    if (!color && !this.scene.map.bitmaps.has(bitmap)) return;
    for (const index of cells) if (index >= 0 && index < this.scene.map.width * this.scene.map.height) {
      this.terrainWrite('bitmap', String(bitmap), index, color);
    }
  }
  refreshTerrain(full = false): void {
    if (!full && !this.terrainDirty) return;
    if (full) {
      Object.assign(this.scene, generateTilezedScene(this.scene.map));
      this.terrainRegion = { x: 0, y: 0, width: this.scene.map.width, height: this.scene.map.height };
    } else this.terrainRegion = this.terrainUpdater.update(this.scene, this.terrainDirty!);
    this.terrainDirty = undefined; this.terrainRevision++;
  }
  private changedRegion(cells: Iterable<{ index: number }>): TerrainRegion | undefined {
    const map = this.scene.map;
    let left = map.width, top = map.height, right = -1, bottom = -1;
    for (const { index } of cells) {
      const x = index % map.width, y = Math.floor(index / map.width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return right < 0 ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }
  toggleTerrainBlending(layer: string, cells: Iterable<number>, allLayers: boolean): void {
    const names = new Set(this.scene.map.blends.map(blend => blend.layer).filter(name => this.scene.map.layers.some(item => item.name === name)));
    if (!names.has(layer)) return;
    const resolve = tileResolver(this.scene.map), blendTiles = new Set(this.scene.map.blends.flatMap(blend => resolve(blend.tile)));
    for (const index of cells) {
      const value = this.scene.map.noBlend?.get(layer)?.[index] ? 0 : 1;
      for (const name of allLayers ? names : [layer]) {
        this.terrainWrite('mask', name, index, value);
        if (blendTiles.has(this.scene.map.layers.find(item => item.name === name)?.gids[index] ?? 0)) this.terrainWrite('raw', name, index, 0);
      }
    }
  }
  bakeTerrain(cells: Iterable<number>): void {
    const map = this.scene.map, region = new Set(cells), expanded = new Set<number>();
    for (const index of region) {
      const x = index % map.width, y = Math.floor(index / map.width);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (x + dx >= 0 && x + dx < map.width && y + dy >= 0 && y + dy < map.height) expanded.add((y + dy) * map.width + x + dx);
      }
    }
    for (const layer of this.scene.layers) for (const index of expanded) {
      if (layer.gids[index]) this.terrainWrite('raw', layer.name, index, layer.gids[index]);
    }
    this.paintTerrain(0, region, 0); this.paintTerrain(1, region, 0);
  }
  finish(): void {
    if (this.terrainStroke) {
      const terrain = [...this.terrainStroke.values()].filter(change => change.before !== change.after);
      const before = this.terrainSelectionBefore, after = new Set(this.terrainSelection);
      const warningsBefore = this.terrainWarningsBefore!;
      const selectionChanged = before && (before.size !== after.size || [...before].some(index => !after.has(index)));
      this.terrainStroke = undefined;
      this.terrainSelectionBefore = undefined;
      this.terrainWarningsBefore = undefined;
      if (terrain.length || selectionChanged) {
        if (terrain.length) { this.refreshTerrain(); this.scene.warnings = terrainColorWarnings(this.scene.map, this.scene.warnings); }
        this.record({ layer: '', changes: [], terrain,
          ...(terrain.length ? { terrainWarnings: { before: warningsBefore, after: this.scene.warnings } } : {}),
          ...(selectionChanged ? { terrainSelection: { before, after } } : {}) });
      }
    }
    const stroke = this.stroke;
    this.stroke = undefined;
    if (!stroke?.changes.size) return;
    this.record({ layer: stroke.layer, changes: [...stroke.changes.values()] });
  }
  private record(change: Omit<Edit, 'before' | 'after'>): void {
    const selectionOnly = !!change.terrainSelection && !change.terrain?.length;
    const edit: Edit = { ...change, before: this.state, after: selectionOnly ? this.state : ++this.nextState };
    this.state = edit.after;
    this.past.push(edit);
    this.future = [];
    // Keep at least the most recent operation, even for a large fill.
    const size = (item: Edit) => item.changes.length + (item.terrain?.length ?? 0) + (item.terrainSelection?.before.size ?? 0) + (item.terrainSelection?.after.size ?? 0);
    let cells = this.past.reduce((sum, item) => sum + size(item), 0);
    while (this.past.length > 1 && (this.past.length > 100 || cells > 250000)) cells -= size(this.past.shift()!);
  }
  undo(): TilezedHistoryChange | undefined {
    this.finish(); const edit = this.past.pop();
    if (edit) { const change = this.apply(edit, false); this.future.push(edit); return change; }
    return undefined;
  }
  redo(): TilezedHistoryChange | undefined {
    this.finish(); const edit = this.future.pop();
    if (edit) { const change = this.apply(edit, true); this.past.push(edit); return change; }
    return undefined;
  }
  private apply(edit: Edit, forward: boolean): TilezedHistoryChange {
    if (edit.settings) {
      Object.assign(this.scene.map, forward ? edit.settings.after : edit.settings.before);
      this.settingsTouched = true; this.refreshTerrain(true); this.state = forward ? edit.after : edit.before; return 'settings';
    }
    if (edit.terrain) {
      for (const change of edit.terrain) this.terrainArray(change.kind, change.key)[change.index] = forward ? change.after : change.before;
      if (edit.terrainSelection) this.terrainSelection = new Set(forward ? edit.terrainSelection.after : edit.terrainSelection.before);
      if (edit.terrain.length) {
        this.terrainDirty = this.changedRegion(edit.terrain); this.refreshTerrain();
        this.scene.warnings = forward ? edit.terrainWarnings!.after : edit.terrainWarnings!.before;
      }
      this.state = forward ? edit.after : edit.before;
      return edit.terrain.length ? 'region' : 'selection';
    }
    if (edit.movedLayer) {
      const { from, to } = edit.movedLayer;
      this.reorderLayer(forward ? from : to, forward ? to : from);
      this.state = forward ? edit.after : edit.before;
      return 'layers';
    }
    if (edit.lotChange) {
      const { index, before, after } = edit.lotChange;
      const from = forward ? before : after, to = forward ? after : before;
      this.lots.splice(index, from ? 1 : 0, ...(to ? [to] : []));
      this.state = forward ? edit.after : edit.before;
      return 'lots';
    }
    if (edit.newLayer) {
      const { index, raw, visible, mask } = edit.newLayer;
      if (forward) {
        this.scene.map.layers.splice(index, 0, raw); this.scene.layers.splice(index, 0, visible);
        this.scene.map.noBlend!.set(raw.name, mask);
      } else {
        this.scene.map.layers.splice(index, 1); this.scene.layers.splice(index, 1);
        this.scene.map.noBlend!.delete(raw.name);
      }
      this.state = forward ? edit.after : edit.before;
      return 'layers';
    }
    const raw = this.scene.map.layers.find(item => item.name === edit.layer)!;
    const visible = this.scene.layers.find(item => item.name === edit.layer)!;
    const mask = this.scene.map.noBlend!.get(edit.layer)!;
    for (const change of edit.changes) {
      raw.gids[change.index] = forward ? change.next : change.raw;
      visible.gids[change.index] = forward ? change.next : change.visible;
      mask[change.index] = forward ? 1 : change.mask;
    }
    this.terrainRegion = this.changedRegion(edit.changes); this.terrainRevision++;
    // A redo can restore a sheet no longer present in the current layer coverage.
    // Inspect the changed cells instead of rescanning every map layer.
    if (visible.visible && visible.opacity) {
      const used = new Map(this.scene.usedSheets.map(item => [item.tileset.firstGid, item]));
      let changed = false;
      for (const cell of edit.changes) {
        const gid = visible.gids[cell.index]; if (!gid) continue;
        const tileset = tilesetForGid(this.scene.map.tilesets, gid)!, maxIndex = gid - tileset.firstGid;
        const previous = used.get(tileset.firstGid);
        if (!previous || previous.maxIndex < maxIndex) { used.set(tileset.firstGid, { tileset, maxIndex }); changed = true; }
      }
      if (changed) this.scene.usedSheets = [...used.values()];
    }
    this.state = forward ? edit.after : edit.before;
    return 'region';
  }

  async serialize(includePlacedLots = true): Promise<string> {
    this.finish();
    const document = this.source.cloneNode(true) as Document;
    const root = document.documentElement;
    if (this.settingsTouched) {
      const old = Array.from(root.children).find(item => item.tagName === 'bmp-settings');
      const replacement = writeTerrainSettingsXml(document, terrainSettings(this.scene.map));
      old ? root.replaceChild(replacement, old) : root.appendChild(replacement);
    }
    for (const index of this.touchedBitmaps) {
      const bitmap = this.scene.map.bitmaps.get(index)!;
      let element = Array.from(root.children).find(item => item.tagName === 'bmp-image' && Number(item.getAttribute('index')) === index);
      if (!element) { element = document.createElement('bmp-image'); root.appendChild(element); }
      element.setAttribute('index', String(index)); element.setAttribute('seed', String(bitmap.seed));
      element.replaceChildren();
      const palette = new Map<number, number>(), bytes = new Uint8Array(bitmap.pixels.length * 4), view = new DataView(bytes.buffer);
      bitmap.pixels.forEach((color, pixel) => {
        if (!color) return;
        if (!palette.has(color)) palette.set(color, palette.size + 1);
        view.setUint32(pixel * 4, palette.get(color)!, true);
      });
      for (const color of palette.keys()) {
        const entry = document.createElement('color'); entry.setAttribute('rgb', `${color >>> 16} ${(color >>> 8) & 255} ${color & 255}`); element.appendChild(entry);
      }
      const pixels = document.createElement('pixels'); element.appendChild(pixels);
      const compressed = new Uint8Array(await new Response(new Blob([bytes.buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      const parts: string[] = [];
      for (let offset = 0; offset < compressed.length; offset += 32768) parts.push(String.fromCharCode(...compressed.subarray(offset, offset + 32768)));
      pixels.textContent = btoa(parts.join(''));
    }
    const existingTilesets = new Set(Array.from(root.children).filter(item => {
      if (item.tagName !== 'tileset') return false;
      const image = Array.from(item.children).find(child => child.tagName === 'image');
      // An empty legacy declaration can share its firstgid with a newly added usable sheet.
      const spacing = Number(item.getAttribute('spacing') ?? 0), margin = Number(item.getAttribute('margin') ?? 0);
      return image && tilezedAxisCount(Number(image.getAttribute('width')), Number(item.getAttribute('tilewidth')), spacing, margin) > 0
        && tilezedAxisCount(Number(image.getAttribute('height')), Number(item.getAttribute('tileheight')), spacing, margin) > 0;
    }).map(item => Number(item.getAttribute('firstgid'))));
    for (const sheet of this.scene.map.tilesets) {
      if (existingTilesets.has(sheet.firstGid)) continue;
      const element = document.createElement('tileset');
      for (const [key, value] of Object.entries({ firstgid: sheet.firstGid, name: sheet.name, tilewidth: sheet.tileWidth, tileheight: sheet.tileHeight })) element.setAttribute(key, String(value));
      if (sheet.spacing) element.setAttribute('spacing', String(sheet.spacing));
      if (sheet.margin) element.setAttribute('margin', String(sheet.margin));
      if (sheet.offsetX || sheet.offsetY) {
        const offset = document.createElement('tileoffset'); offset.setAttribute('x', String(sheet.offsetX ?? 0)); offset.setAttribute('y', String(sheet.offsetY ?? 0)); element.appendChild(offset);
      }
      const image = document.createElement('image');
      image.setAttribute('source', sheet.source); image.setAttribute('width', String(sheet.imageWidth)); image.setAttribute('height', String(sheet.imageHeight));
      element.appendChild(image); root.insertBefore(element, Array.from(root.children).find(item => item.tagName === 'layer') ?? null);
    }
    for (const layer of this.scene.map.layers) {
      const groundLayers = Array.from(root.children).filter(item => item.tagName === 'layer' && tilezedLayerName(item).level === 0);
      if (groundLayers.some(item => tilezedLayerName(item).name === layer.name)) continue;
      const element = document.createElement('layer');
      element.setAttribute('name', layer.name); element.setAttribute('width', String(this.scene.map.width)); element.setAttribute('height', String(this.scene.map.height));
      element.appendChild(document.createElement('data'));
      const previous = groundLayers.at(-1);
      root.insertBefore(element, previous?.nextSibling ?? null);
    }
    // Move the original XML nodes between ground-layer slots. This retains their
    // data encoding, properties and attributes, and leaves other levels/groups in place.
    const groundLayers = Array.from(root.children).filter(item => item.tagName === 'layer' && tilezedLayerName(item).level === 0);
    const byName = new Map(groundLayers.map(element => [tilezedLayerName(element).name, element]));
    const slots = groundLayers.map(element => {
      const slot = document.createComment('layer-order'); root.replaceChild(slot, element); return slot;
    });
    this.scene.map.layers.forEach((layer, index) => root.replaceChild(byName.get(layer.name)!, slots[index]));
    for (const name of this.touched) {
      const layer = this.scene.map.layers.find(item => item.name === name);
      if (!layer) continue; // A newly added layer may have been undone.
      const element = Array.from(root.children).find(item => item.tagName === 'layer' && tilezedLayerName(item).name === name)!;
      const data = Array.from(element.children).find(item => item.tagName === 'data')!;
      data.removeAttribute('compression');
      data.setAttribute('encoding', 'csv');
      data.textContent = '\n' + Array.from({ length: this.scene.map.height }, (_, y) =>
        Array.from(layer.gids.subarray(y * this.scene.map.width, (y + 1) * this.scene.map.width)).join(',')).join(',\n') + '\n';
      const bits = this.scene.map.noBlend!.get(name) ?? new Uint8Array(this.scene.map.width * this.scene.map.height);
      let noBlend = Array.from(root.children).find(item => item.tagName === 'bmp-noblend' && item.getAttribute('layer') === name);
      if (!bits.some(bit => bit !== 0)) { noBlend?.remove(); continue; }
      if (!noBlend) { noBlend = document.createElement('bmp-noblend'); noBlend.setAttribute('layer', name); root.appendChild(noBlend); }
      let bitElement = Array.from(noBlend.children).find(item => item.tagName === 'bits');
      if (!bitElement) { bitElement = document.createElement('bits'); noBlend.appendChild(bitElement); }
      const compressed = new Uint8Array(await new Response(new Blob([bits.slice().buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      const parts: string[] = [];
      for (let offset = 0; offset < compressed.length; offset += 32768) parts.push(String.fromCharCode(...compressed.subarray(offset, offset + 32768)));
      bitElement.textContent = btoa(parts.join(''));
    }
    // Update original TMX lot nodes in place, retaining object/group properties and IDs.
    const mapLots = Array.from(root.children).filter(group => group.tagName === 'objectgroup' && group.getAttribute('visible') !== '0')
      .flatMap(group => Array.from(group.children).filter(object => object.tagName === 'object' && object.getAttribute('name') === 'lot' && object.getAttribute('visible') !== '0'));
    const managedMapLots = new Map(this.lots.filter(lot => this.origins.get(lot)?.kind === 'map').map(lot => [this.origins.get(lot)!.index, lot]));
    const managesMapLots = [...this.origins.values()].some(origin => origin.kind === 'map');
    mapLots.forEach((element, index) => {
      // WorldEd lots are stored in the PZW; embedded TMX objects belong to the map itself.
      if (!managesMapLots) return;
      const current = managedMapLots.get(index);
      if (!current) { element.remove(); return; }
      for (const key of ['x', 'y', 'width', 'height'] as const) element.setAttribute(key, String(current[key] * this.scene.map.tileHeight));
    });
    const additional = this.lots.filter(lot => this.origins.get(lot)?.kind !== 'map');
    if (includePlacedLots && additional.length) {
      // Separate groups retain placement levels when exporting WorldEd lots.
      for (const lot of additional) {
        let target = Array.from(root.children).find(item => item.tagName === 'objectgroup' && item.getAttribute('visible') !== '0' && item.getAttribute('name') === `${lot.level}_Buildings` && tilezedLayerName(item).level === lot.level);
        if (!target) { target = document.createElement('objectgroup'); target.setAttribute('name', `${lot.level}_Buildings`); root.appendChild(target); }
        const object = document.createElement('object');
        object.setAttribute('name', 'lot'); object.setAttribute('type', lot.map);
        for (const key of ['x', 'y', 'width', 'height'] as const) object.setAttribute(key, String(lot[key] * this.scene.map.tileHeight));
        target.appendChild(object);
      }
    }
    return new XMLSerializer().serializeToString(document);
  }
}
