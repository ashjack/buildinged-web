import { TilePoint, TilezedEditDocument, tileLine, tileRectangle } from './tilezed-edit';
import { TilezedRule } from './tilezed-map';

export type TerrainTool = 'brush' | 'rectangle' | 'bucket' | 'select' | 'wand' | 'eraser' | 'bake' | 'no-blend' | 'pick';
export interface TerrainModifiers { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; }
type Clipboard = { width: number; height: number; cells: { x: number; y: number; colors: number[] }[]; both: boolean };

/** BMP tools use bitmap pixels (one per map square), separately from manual tile stamps. */
export class TilezedTerrainTools {
  tool: TerrainTool = 'brush';
  bitmap = 0;
  color = 0;
  size = 1;
  shape: 'square' | 'circle' | 'custom' = 'square';
  custom?: { width: number; height: number; pixels: Uint8Array };
  restrict = false;
  fillAll = false;
  get selection(): Set<number> { return this.editor.terrainSelection; }
  set selection(value: Set<number>) { this.editor.terrainSelection = value; }
  preview = new Set<number>();
  clipboard?: Clipboard;
  pasting = false;
  private gesture?: { start: TilePoint; last: TilePoint; base: Set<number>; mods: TerrainModifiers; moving: boolean };
  private paletteRules?: TilezedRule[];
  private paletteBitmap = -1;
  private palette: { color: number; label: string }[] = [];
  constructor(readonly editor: TilezedEditDocument) { this.chooseBitmap(0); }
  get map() { return this.editor.scene.map; }
  get colors(): { color: number; label: string }[] {
    if (this.paletteRules === this.map.rules && this.paletteBitmap === this.bitmap) return this.palette;
    const groups = new Map<number, Set<string>>();
    for (const rule of this.map.rules.filter(rule => rule.bitmap === this.bitmap)) {
      if (!groups.has(rule.color)) groups.set(rule.color, new Set());
      (rule.label ? [rule.label] : rule.choices).forEach(choice => groups.get(rule.color)!.add(choice));
    }
    this.paletteRules = this.map.rules; this.paletteBitmap = this.bitmap;
    return this.palette = [...groups].map(([color, labels]) => ({ color, label: [...labels].join(', ') }));
  }
  chooseBitmap(index: number): void {
    this.finish(); this.bitmap = index;
    if (!this.colors.some(item => item.color === this.color)) this.color = this.colors.find(item => item.color)?.color ?? 0;
  }
  setTool(tool: TerrainTool): void { this.finish(); this.pasting = false; this.tool = tool; this.preview.clear(); }
  private ctrl(mods: TerrainModifiers): boolean { return !!(mods.ctrlKey || mods.metaKey); }
  private index(point: TilePoint): number { return point.y * this.map.width + point.x; }
  private point(index: number): TilePoint { return { x: index % this.map.width, y: Math.floor(index / this.map.width) }; }
  private add(region: Set<number>, x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < this.map.width && y < this.map.height) region.add(y * this.map.width + x);
  }
  private allowed(region: Set<number>): Set<number> {
    return this.restrict && this.selection.size ? new Set([...region].filter(index => this.selection.has(index))) : region;
  }
  brush(point: TilePoint): Set<number> {
    const cells = new Set<number>(), size = Math.max(1, Math.min(300, Math.floor(this.size) || 1));
    if (this.shape === 'custom' && this.custom) {
      const mask = this.custom;
      for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
        if (mask.pixels[y * mask.width + x]) this.add(cells, point.x + x - Math.floor(mask.width / 2), point.y + y - Math.floor(mask.height / 2));
      }
      return this.allowed(cells);
    }
    const startX = point.x - Math.floor(size / 2), startY = point.y - Math.floor(size / 2);
    if (this.shape === 'square' || size < 3) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) this.add(cells, startX + x, startY + y);
    } else if (size === 4) {
      for (let y = -2; y < 2; y++) for (let x = -2; x < 2; x++) if ((x > -2 && x < 1) || (y > -2 && y < 1)) this.add(cells, point.x + x, point.y + y);
    } else {
      // Same midpoint-circle spans and even-diameter centre removal as TileZed's BmpBrushTool.
      const radius = Math.floor(size / 2), even = size % 2 === 0;
      const dot = (x: number, y: number) => {
        if (even && (!x || !y)) return;
        this.add(cells, point.x + x - (even && x > 0 ? 1 : 0), point.y + y - (even && y > 0 ? 1 : 0));
      };
      const span = (x: number, y: number) => {
        for (let i = -x; i <= x; i++) { dot(i, y); dot(i, -y); }
        for (let i = -y; i <= y; i++) { dot(i, x); dot(i, -x); }
      };
      let x = 0, y = radius, p = Math.trunc((5 - radius * 4) / 4);
      while (x <= y) { span(x, y); x++; if (p < 0) p += 2 * x + 1; else { y--; p += 2 * (x - y) + 1; } }
    }
    return this.allowed(cells);
  }
  private rectangle(a: TilePoint, b: TilePoint, square = false): Set<number> {
    if (square) {
      const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      b = { x: a.x + (b.x < a.x ? -side : side), y: a.y + (b.y < a.y ? -side : side) };
    }
    const rect = tileRectangle(a, b), cells = new Set<number>();
    for (let y = Math.max(0, rect.y); y < Math.min(this.map.height, rect.y + rect.height); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(this.map.width, rect.x + rect.width); x++) this.add(cells, x, y);
    }
    return cells;
  }
  flood(point: TilePoint, all = false): Set<number> {
    const result = new Set<number>();
    if (!this.editor.contains(point)) return result;
    const pixels = this.map.bitmaps.get(this.bitmap)?.pixels, target = pixels?.[this.index(point)] ?? 0;
    if (all) {
      for (const index of this.selection) if ((pixels?.[index] ?? 0) === target) result.add(index);
      return result;
    }
    const count = this.map.width * this.map.height, seen = new Uint8Array(count), queue = [this.index(point)];
    seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head], x = index % this.map.width;
      if ((pixels?.[index] ?? 0) !== target) continue;
      result.add(index);
      // Native BMP flood fill joins diagonal pixels as well as horizontal/vertical neighbours.
      for (const next of [x ? index - 1 : -1, x < this.map.width - 1 ? index + 1 : -1, index - this.map.width, index + this.map.width,
        x ? index - this.map.width - 1 : -1, x < this.map.width - 1 ? index - this.map.width + 1 : -1,
        x ? index + this.map.width - 1 : -1, x < this.map.width - 1 ? index + this.map.width + 1 : -1]) {
        if (next >= 0 && next < count && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    return result;
  }
  down(point: TilePoint, mods: TerrainModifiers): void {
    this.finish();
    if (!this.editor.contains(point)) return;
    if (this.pasting) { this.paste(point); return; }
    if (this.tool === 'pick') { this.color = this.map.bitmaps.get(this.bitmap)?.pixels[this.index(point)] ?? 0; return; }
    const moving = ['select', 'wand'].includes(this.tool) && this.selection.has(this.index(point)) && !this.ctrl(mods) && !mods.shiftKey;
    this.gesture = { start: point, last: point, base: new Set(this.selection), mods, moving };
    if (this.tool === 'wand' && !moving) { this.combine(this.flood(point), mods); this.gesture = undefined; return; }
    if (this.tool === 'select' || moving || ['rectangle', 'no-blend'].includes(this.tool)) { this.move(point, mods); return; }
    this.editor.beginTerrain();
    if (this.tool === 'bucket') {
      this.editor.paintTerrain(this.bitmap, this.allowed(this.flood(point, this.restrict && this.fillAll && !!this.selection.size)), this.ctrl(mods) ? 0 : this.color);
      this.finish(); return;
    }
    this.preview = this.brush(point); this.paint(this.preview, mods); this.editor.refreshTerrain();
  }
  move(point: TilePoint, mods: TerrainModifiers, refresh = true): void {
    const gesture = this.gesture;
    if (!gesture) {
      this.preview = this.pasting ? this.translatedClipboard(point) : this.tool === 'bucket' ? this.allowed(this.flood(point, this.restrict && this.fillAll && !!this.selection.size)) : this.brush(point);
      return;
    }
    if (gesture.moving) {
      this.preview = this.translate(gesture.base, point.x - gesture.start.x, point.y - gesture.start.y);
    } else if (['select', 'rectangle', 'no-blend'].includes(this.tool)) {
      this.preview = this.rectangle(gesture.start, point, this.tool === 'rectangle' && mods.shiftKey);
    } else {
      const cells = new Set<number>();
      for (const center of tileLine(gesture.last, point)) for (const index of this.brush(center)) cells.add(index);
      this.preview = this.brush(point);
      this.paint(cells, mods); if (refresh) this.editor.refreshTerrain();
    }
    gesture.last = point;
  }
  up(point: TilePoint, mods: TerrainModifiers, layer: string): void {
    if (!this.gesture) return;
    this.move(point, mods);
    const gesture = this.gesture;
    if (gesture.moving) {
      this.moveSelection(point.x - gesture.start.x, point.y - gesture.start.y, this.ctrl(mods), !!mods.shiftKey);
    } else if (this.tool === 'select') this.combine(this.preview, gesture.mods);
    else if (this.tool === 'rectangle' || this.tool === 'no-blend') {
      this.editor.beginTerrain();
      if (this.tool === 'no-blend') this.editor.toggleTerrainBlending(layer, this.allowed(this.preview), !!mods.shiftKey);
      else this.paint(this.allowed(this.preview), mods);
    }
    this.finish();
  }
  private paint(cells: Set<number>, mods: TerrainModifiers): void {
    if (this.tool === 'bake') this.editor.bakeTerrain(cells);
    else this.editor.paintTerrain(this.bitmap, cells, this.tool === 'eraser' || this.ctrl(mods) ? 0 : this.color);
  }
  finish(): void { this.editor.finish(); this.gesture = undefined; this.preview.clear(); }
  cancel(): void { this.finish(); this.pasting = false; }
  private combine(region: Set<number>, mods: TerrainModifiers): void {
    const ctrl = this.ctrl(mods), shift = !!mods.shiftKey;
    this.editor.beginTerrain();
    const selected = ctrl && shift ? new Set([...this.selection].filter(index => region.has(index))) : ctrl ? new Set([...this.selection, ...region]) : shift ? new Set([...this.selection].filter(index => !region.has(index))) : new Set(region);
    this.editor.selectTerrain(selected); this.editor.finish();
    this.preview.clear();
  }
  private translate(region: Set<number>, dx: number, dy: number): Set<number> {
    const moved = new Set<number>();
    for (const index of region) { const p = this.point(index); this.add(moved, p.x + dx, p.y + dy); }
    return moved;
  }
  private capture(both: boolean): Clipboard | undefined {
    if (!this.selection.size) return undefined;
    const points = [...this.selection].map(index => this.point(index));
    let x = this.map.width, y = this.map.height, right = 0, bottom = 0;
    for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
    return { width: right - x + 1, height: bottom - y + 1, both,
      cells: points.map(p => ({ x: p.x - x, y: p.y - y, colors: [0, 1].map(b => this.map.bitmaps.get(b)?.pixels[this.index(p)] ?? 0) })) };
  }
  copy(both = true): void { this.clipboard = this.capture(both); }
  startPaste(): void { this.finish(); if (this.clipboard) { this.pasting = true; this.tool = 'brush'; } }
  private translatedClipboard(point: TilePoint): Set<number> {
    const cells = new Set<number>();
    for (const cell of this.clipboard?.cells ?? []) this.add(cells, point.x + cell.x, point.y + cell.y);
    return cells;
  }
  private paste(point: TilePoint, clipboard = this.clipboard): void {
    if (!clipboard) return;
    this.editor.beginTerrain();
    for (const cell of clipboard.cells) {
      const p = { x: point.x + cell.x, y: point.y + cell.y };
      if (this.editor.contains(p)) for (const b of clipboard.both ? [0, 1] : [this.bitmap]) this.editor.paintTerrain(b, [this.index(p)], cell.colors[b]);
    }
    this.editor.finish();
  }
  moveSelection(dx: number, dy: number, copy = false, both = false): void {
    const clip = this.capture(both);
    if (!clip || (!dx && !dy)) return;
    let left = this.map.width, top = this.map.height;
    for (const index of this.selection) { const p = this.point(index); left = Math.min(left, p.x); top = Math.min(top, p.y); }
    this.editor.beginTerrain();
    if (!copy) for (const b of both ? [0, 1] : [this.bitmap]) this.editor.paintTerrain(b, this.selection, 0);
    // Keep clearing and pasting in the same history command; read from the snapshot for overlapping moves.
    for (const cell of clip.cells) {
      const p = { x: left + dx + cell.x, y: top + dy + cell.y };
      if (this.editor.contains(p)) for (const b of both ? [0, 1] : [this.bitmap]) this.editor.paintTerrain(b, [this.index(p)], cell.colors[b]);
    }
    this.editor.selectTerrain(this.translate(this.selection, dx, dy)); this.editor.finish();
  }
  eraseSelection(): void {
    if (!this.selection.size) return;
    this.editor.beginTerrain(); this.editor.paintTerrain(this.bitmap, this.selection, 0); this.editor.finish();
  }
}
