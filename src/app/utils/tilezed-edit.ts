import { TilezedLayer, tilezedLayerName, tilesetForGid } from './tilezed-map';
import { TilezedScene } from './tilezed-terrain';
import { TilezedCamera, TilezedViewport } from './tilezed-renderer';

export type TilezedTool = 'pan' | 'stamp' | 'bucket' | 'eraser' | 'select' | 'pick';
export interface TilePoint { x: number; y: number; }
export interface TileRectangle extends TilePoint { width: number; height: number; }
export interface TileStamp { width: number; height: number; gids: Uint32Array; }
interface Change { index: number; raw: number; visible: number; mask: number; next: number; }
interface Edit { layer: string; changes: Change[]; before: number; after: number; }

export function tilezedTileAtPixel(map: { height: number; tileWidth: number; tileHeight: number },
                                  camera: TilezedCamera, viewport: TilezedViewport, x: number, y: number): TilePoint {
  const dx = (camera.x + (x - viewport.width / 2) / camera.zoom - map.height * map.tileWidth / 2) / (map.tileWidth / 2);
  const dy = (camera.y + (y - viewport.height / 2) / camera.zoom) / (map.tileHeight / 2);
  return { x: Math.floor((dx + dy) / 2), y: Math.floor((dy - dx) / 2) };
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

/** Owns unsaved tile edits only. Persistence is always initiated by the caller's Save action. */
export class TilezedEditDocument {
  readonly scene: TilezedScene;
  selection?: TileRectangle;
  private readonly source: Document;
  private readonly touched = new Set<string>();
  private past: Edit[] = [];
  private future: Edit[] = [];
  private stroke?: { layer: string; changes: Map<number, Change> };
  private state = 0;
  private nextState = 0;
  private savedState = 0;

  constructor(xml: string, scene: TilezedScene) {
    this.source = new DOMParser().parseFromString(xml, 'application/xml');
    this.scene = { ...scene, map: { ...scene.map,
      layers: scene.map.layers.map(layer => ({ ...layer, gids: layer.gids.slice() })),
      noBlend: new Map([...(scene.map.noBlend ?? [])].map(([name, bits]) => [name, bits.slice()])) },
      layers: scene.layers.map(layer => ({ ...layer, gids: layer.gids.slice() })) };
  }

  get dirty(): boolean { return this.state !== this.savedState || !!this.stroke?.changes.size; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  markSaved(): void { this.finish(); this.savedState = this.state; }
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
  finish(): void {
    const stroke = this.stroke;
    this.stroke = undefined;
    if (!stroke?.changes.size) return;
    const edit = { layer: stroke.layer, changes: [...stroke.changes.values()], before: this.state, after: ++this.nextState };
    this.state = edit.after;
    this.past.push(edit);
    this.future = [];
    // Keep at least the most recent operation, even for a large fill.
    let cells = this.past.reduce((sum, item) => sum + item.changes.length, 0);
    while (this.past.length > 1 && (this.past.length > 100 || cells > 250000)) cells -= this.past.shift()!.changes.length;
  }
  undo(): void { this.finish(); const edit = this.past.pop(); if (edit) { this.apply(edit, false); this.future.push(edit); } }
  redo(): void { this.finish(); const edit = this.future.pop(); if (edit) { this.apply(edit, true); this.past.push(edit); } }
  private apply(edit: Edit, forward: boolean): void {
    const raw = this.scene.map.layers.find(item => item.name === edit.layer)!;
    const visible = this.scene.layers.find(item => item.name === edit.layer)!;
    const mask = this.scene.map.noBlend!.get(edit.layer)!;
    for (const change of edit.changes) {
      raw.gids[change.index] = forward ? change.next : change.raw;
      visible.gids[change.index] = forward ? change.next : change.visible;
      mask[change.index] = forward ? 1 : change.mask;
    }
    this.state = forward ? edit.after : edit.before;
  }

  async serialize(): Promise<string> {
    this.finish();
    const document = this.source.cloneNode(true) as Document;
    const root = document.documentElement;
    for (const name of this.touched) {
      const layer = this.scene.map.layers.find(item => item.name === name)!;
      const element = Array.from(root.children).find(item => item.tagName === 'layer' && tilezedLayerName(item).name === name)!;
      const data = Array.from(element.children).find(item => item.tagName === 'data')!;
      data.removeAttribute('compression');
      data.setAttribute('encoding', 'csv');
      data.textContent = '\n' + Array.from({ length: this.scene.map.height }, (_, y) =>
        Array.from(layer.gids.subarray(y * this.scene.map.width, (y + 1) * this.scene.map.width)).join(',')).join(',\n') + '\n';
      const bits = this.scene.map.noBlend!.get(name)!;
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
    return new XMLSerializer().serializeToString(document);
  }
}
