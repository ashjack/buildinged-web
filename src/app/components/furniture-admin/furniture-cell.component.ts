import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { BEntry } from '../../models/furniture-window.models';
import { MAX_FURNITURE_COORD, coords, entrySize } from '../../utils/furniture-editing';

export const FURNITURE_TILE_MIME = 'application/x-buildinged-tiles';

/**
 * The tiles being dragged from the tile browser. Chrome can lose custom drag data types when an image is
 * dragged (the drag then only carries text/uri-list and text/html), so cells read this instead.
 */
export const furnitureTileDrag: { tiles: string[] | null } = { tiles: null };

function draggedTiles(event: DragEvent): string[] | null {
  if (furnitureTileDrag.tiles?.length) return furnitureTileDrag.tiles;
  if (!event.dataTransfer?.types.includes(FURNITURE_TILE_MIME)) return null;
  if (event.type !== 'drop') return [];
  try {
    const tiles = JSON.parse(event.dataTransfer.getData(FURNITURE_TILE_MIME));
    return Array.isArray(tiles) && tiles.length && tiles.every(tile => typeof tile === 'string') ? tiles : null;
  } catch {
    return null;
  }
}

// 1x isometric metrics: a floor square is 64x32 and a tile image is 64x128 with the floor at its bottom.
const HALF_W = 32, HALF_H = 16, IMAGE_W = 64, IMAGE_H = 128, HEADROOM = 96, PAD = 6;

export interface FurnitureCellPoint { x: number; y: number; }
export interface FurnitureCellDrop extends FurnitureCellPoint { tiles: string[]; }

/** One orientation of a furniture item, drawn like a cell of the desktop editor's FurnitureView. */
@Component({
  selector: 'app-furniture-cell',
  template: `<canvas #canvas role="img" [attr.aria-label]="orient + ' orientation, ' + (entry?.items?.length || 0) + ' tiles'"
    (click)="picked.emit()" (contextmenu)="onContextMenu($event)" (mousemove)="onHover($event)" (mouseleave)="setHover(null)"
    (dragenter)="onDragOver($event)" (dragover)="onDragOver($event)" (dragleave)="onDragLeave()" (drop)="onDrop($event)"></canvas>`,
  styles: [`:host { display: block; line-height: 0; } canvas { display: block; cursor: pointer; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FurnitureCellComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() entry?: BEntry;
  @Input() orient = 'W';
  @Input() scale = .5;
  @Input() selected = false;
  @Input() images?: (name: string) => Promise<ImageBitmap | null>;
  @Output() picked = new EventEmitter<void>();
  @Output() dropped = new EventEmitter<FurnitureCellDrop>();
  @Output() cleared = new EventEmitter<FurnitureCellPoint>();
  @ViewChild('canvas', { static: true }) canvas?: ElementRef<HTMLCanvasElement>;

  private loaded = new Map<string, ImageBitmap | null>();
  private hover: FurnitureCellPoint | null = null;
  private version = 0;
  private destroyed = false;

  ngOnChanges(): void { void this.load(); }
  ngAfterViewInit(): void { this.draw(); }
  ngOnDestroy(): void { this.destroyed = true; }

  /** Grid shown for drops: one spare row and column so the furniture can grow, as on the desktop. */
  private get grid() {
    const { width, height } = entrySize(this.entry);
    return { width: Math.min(width + 1, MAX_FURNITURE_COORD + 1), height: Math.min(height + 1, MAX_FURNITURE_COORD + 1) };
  }

  private async load(): Promise<void> {
    const version = ++this.version;
    this.draw();
    const pending = [...new Set((this.entry?.items ?? []).map(item => item.tile))].filter(name => !this.loaded.has(name));
    const images = this.images;
    if (!pending.length || !images) return;
    const results = await Promise.all(pending.map(name => images(name + '.png').catch(() => null)));
    if (this.destroyed || version !== this.version) return;
    pending.forEach((name, i) => this.loaded.set(name, results[i]));
    this.draw();
  }

  /** The grid square under the pointer, or null outside the grid. */
  pointAt(event: { clientX: number; clientY: number }): FurnitureCellPoint | null {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(), grid = this.grid;
    const u = ((event.clientX - rect.left) / this.scale - PAD - grid.height * HALF_W) / HALF_W;
    const v = ((event.clientY - rect.top) / this.scale - PAD - HEADROOM) / HALF_H;
    const x = Math.floor((u + v) / 2), y = Math.floor((v - u) / 2);
    return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? { x, y } : null;
  }

  setHover(point: FurnitureCellPoint | null): void {
    if (point?.x === this.hover?.x && point?.y === this.hover?.y) return;
    this.hover = point;
    this.draw();
  }

  onHover(event: MouseEvent): void { this.setHover(this.pointAt(event)); }

  onDragLeave(): void {
    try { this.setHover(null); } catch { /* A failed redraw must not affect dragging. */ }
  }

  onDragOver(event: DragEvent): void {
    const point = this.pointAt(event);
    if (!draggedTiles(event) || !point) {
      try { this.setHover(null); } catch { /* A failed redraw must not affect dragging. */ }
      return;
    }
    // Accept before redrawing so a drawing error can't refuse the drop.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    try { this.setHover(point); } catch { /* A failed redraw must not affect dragging. */ }
  }

  onDrop(event: DragEvent): void {
    const point = this.pointAt(event);
    try { this.setHover(null); } catch { /* A failed redraw must not affect dropping. */ }
    const tiles = draggedTiles(event);
    furnitureTileDrag.tiles = null;
    if (!point || !tiles) return;
    event.preventDefault();
    this.dropped.emit({ ...point, tiles });
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.picked.emit();
    const point = this.pointAt(event);
    if (point) this.cleared.emit(point);
  }

  private draw(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
    const grid = this.grid, size = entrySize(this.entry);
    const span = grid.width + grid.height;
    const width = Math.max(span * HALF_W, 96) + PAD * 2, height = span * HALF_H + HEADROOM + PAD * 2;
    const ratio = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) * this.scale;
    const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      canvas.style.width = `${Math.ceil(width * this.scale)}px`; canvas.style.height = `${Math.ceil(height * this.scale)}px`;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const ox = PAD + grid.height * HALF_W, oy = PAD + HEADROOM;
    const diamond = (x: number, y: number) => {
      const tx = ox + (x - y) * HALF_W, ty = oy + (x + y) * HALF_H;
      context.beginPath();
      context.moveTo(tx, ty); context.lineTo(tx + HALF_W, ty + HALF_H); context.lineTo(tx, ty + HALF_H * 2); context.lineTo(tx - HALF_W, ty + HALF_H);
      context.closePath();
    };

    context.lineWidth = 1 / ratio;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        diamond(x, y);
        const spare = x >= size.width || y >= size.height;
        context.fillStyle = spare ? 'rgba(255,255,255,.015)' : 'rgba(255,255,255,.04)';
        context.fill();
        context.strokeStyle = spare ? 'rgba(141,145,152,.18)' : 'rgba(141,145,152,.4)';
        context.stroke();
      }
    }

    const items = (this.entry?.items ?? []).map(item => ({ ...coords(item.pos), tile: item.tile }))
      .sort((a, b) => a.x + a.y - (b.x + b.y) || a.y - b.y);
    for (const item of items) {
      const bitmap = this.loaded.get(item.tile);
      if (bitmap) {
        try {
          context.drawImage(bitmap, ox + (item.x - item.y) * HALF_W - HALF_W, oy + (item.x + item.y) * HALF_H + HALF_H * 2 - IMAGE_H, IMAGE_W, IMAGE_H);
          continue;
        } catch { this.loaded.delete(item.tile); }
      }
      if (bitmap === null) {
        // None of the downloaded tile packs contain this tile.
        diamond(item.x, item.y);
        context.fillStyle = 'rgba(241,157,138,.35)';
        context.fill();
      }
    }

    if (this.hover) {
      diamond(this.hover.x, this.hover.y);
      context.fillStyle = 'rgba(232,176,97,.22)';
      context.fill();
      context.strokeStyle = '#e8b061';
      context.lineWidth = 1.5 / ratio;
      context.stroke();
    }

    context.font = `600 ${Math.round(11 / this.scale)}px Inter, system-ui, sans-serif`;
    context.fillStyle = this.selected ? '#e8b061' : '#8d9198';
    context.textBaseline = 'top';
    context.fillText(this.orient, PAD, PAD);
  }
}
