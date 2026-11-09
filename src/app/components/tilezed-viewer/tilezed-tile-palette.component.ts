import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { TilezedTileset, tilesetForGid } from '../../utils/tilezed-map';
import { TileStamp } from '../../utils/tilezed-edit';
import { TilezedAssetsService } from '../../services/tilezed-assets.service';
import { tilezedSheetGeometry } from '../../utils/tilezed-sheets';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tilezed-tile-palette', standalone: true, imports: [CommonModule],
  template: `
    <div class="dock-panes">
      <section class="tileset-pane" aria-label="Tilesets">
        <div class="filter"><input type="search" placeholder="tileset name" aria-label="Filter tilesets" [value]="filter"
          (input)="filter = $any($event.target).value"><button type="button" *ngIf="filter" (click)="filter = ''" aria-label="Clear tileset filter">×</button></div>
        <div class="tileset-list" role="listbox" aria-label="TileZed tileset">
          <button *ngFor="let item of filteredTilesets" type="button" role="option" [attr.aria-selected]="sheet === item"
            [class.current]="sheet === item" [title]="item.name" (click)="selectSheet(item.firstGid)">
            <span class="sheet-icon" aria-hidden="true">▦</span><span>{{item.name}}</span>
          </button>
          <p *ngIf="!filteredTilesets.length" class="empty-list">No matching tilesets</p>
        </div>
        <div class="list-toolbar"><button type="button" [class.active]="sortByName" [attr.aria-pressed]="sortByName" (click)="sortByName = !sortByName" title="Sort tilesets by name">A–Z</button>
          <span>{{filteredTilesets.length}} / {{tilesets.length}}</span></div>
      </section>
      <section class="sheet-pane" aria-label="Tilesheet preview">
        <div class="sheet-caption" [title]="sheet?.name">{{sheet?.name || 'No tileset selected'}}</div>
        <div #sheetScroll class="sheet-scroll" [style.background-color]="background">
          <div #sheetGrid *ngIf="sheet as sheet" class="sheet-grid" role="grid" tabindex="0" aria-label="Tilesheet. Drag to select a stamp; use arrow keys to select a tile."
            [attr.aria-rowcount]="rowCount" [attr.aria-colcount]="sheet.columns" [style.width.px]="sheet.columns * tileWidth"
            [style.height.px]="rowCount * tileHeight" [style.background-image]="url ? 'url(' + url + ')' : null" [style.background-size]="backgroundSize"
            (pointerdown)="startSelection($event)" (pointermove)="moveSelection($event)" (pointerup)="endSelection($event)"
            (pointercancel)="endSelection($event)" (lostpointercapture)="endSelection($event)" (keydown)="gridKey($event)" (contextmenu)="$event.preventDefault()">
            <div class="tile-selection" role="gridcell" aria-selected="true" [attr.aria-label]="selectionLabel"
              [attr.aria-rowindex]="selection.y + 1" [attr.aria-colindex]="selection.x + 1"
              [style.left.px]="selection.x * tileWidth" [style.top.px]="selection.y * tileHeight"
              [style.width.px]="selection.width * tileWidth" [style.height.px]="selection.height * tileHeight"></div>
          </div>
        </div>
        <p *ngIf="loading" class="sheet-message" role="status">Loading tiles…</p>
        <p *ngIf="error" class="sheet-message error" role="status">{{error}}</p>
        <div class="preview-toolbar">
          <input type="color" aria-label="Tilesheet background color" [value]="background" (input)="background = $any($event.target).value" title="Tilesheet background color">
          <button type="button" aria-label="Zoom tiles out" (click)="changeZoom(-1)" [disabled]="zoom === zoomLevels[0]">−</button>
          <select aria-label="Tilesheet zoom" [value]="zoom" (change)="setZoom(+$any($event.target).value)"><option *ngFor="let scale of zoomLevels" [value]="scale">{{scale * 100}}%</option></select>
          <button type="button" aria-label="Zoom tiles in" (click)="changeZoom(1)" [disabled]="zoom === zoomLevels[zoomLevels.length - 1]">+</button>
        </div>
      </section>
    </div>
    <div class="palette-status" [title]="selectionLabel"><span>{{selectionLabel}}</span><span>{{selection.width}} × {{selection.height}}</span></div>
  `,
  styleUrls: ['./tilezed-tile-palette.component.scss'],
})
export class TilezedTilePaletteComponent implements OnChanges, OnDestroy {
  @Input() tilesets: TilezedTileset[] = [];
  @Input() selectedGid = 0;
  @Output() stampChange = new EventEmitter<TileStamp>();
  @ViewChild('sheetScroll') sheetScroll?: ElementRef<HTMLElement>;
  @ViewChild('sheetGrid') sheetGrid?: ElementRef<HTMLElement>;
  sheet?: TilezedTileset;
  filter = '';
  sortByName = false;
  readonly zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  zoom = 0.5;
  background = '#474747';
  url = '';
  loading = false;
  error = '';
  private imageWidth = 0;
  private imageHeight = 0;
  private availableRows?: number;
  private anchor = 0;
  private end = 0;
  private emittedGid = 0;
  private generation = 0;
  private pointerId?: number;
  private revealFrame?: number;
  private changes: Subscription;
  constructor(private assets: TilezedAssetsService) {
    this.changes = this.assets.changes$?.subscribe(names => { if (this.sheet && names.has(this.sheet.name.toLowerCase())) void this.load(); }) ?? new Subscription();
  }
  get filteredTilesets(): TilezedTileset[] {
    const items = this.tilesets.filter(item => item.name.toLowerCase().includes(this.filter.trim().toLowerCase()));
    return this.sortByName ? items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : items;
  }
  get tileWidth(): number { return (this.sheet?.tileWidth ?? 64) * this.zoom; }
  get tileHeight(): number { return (this.sheet?.tileHeight ?? 128) * this.zoom; }
  get rowCount(): number { return this.availableRows ?? this.sheet?.rows ?? 0; }
  get backgroundSize(): string { return `${this.imageWidth * this.zoom}px ${this.imageHeight * this.zoom}px`; }
  get selection(): { x: number; y: number; width: number; height: number } {
    const columns = this.sheet?.columns ?? 1;
    return { x: Math.min(this.anchor % columns, this.end % columns), y: Math.min(Math.floor(this.anchor / columns), Math.floor(this.end / columns)),
      width: Math.abs(this.anchor % columns - this.end % columns) + 1, height: Math.abs(Math.floor(this.anchor / columns) - Math.floor(this.end / columns)) + 1 };
  }
  get selectionLabel(): string {
    if (!this.sheet) return 'Choose a tileset';
    const index = this.selection.y * this.sheet.columns + this.selection.x;
    return `${this.sheet.name}_${String(index).padStart(3, '0')}`;
  }
  ngOnChanges(): void {
    const picked = tilesetForGid(this.tilesets, this.selectedGid);
    const sheet = picked ?? this.tilesets.find(item => item === this.sheet) ?? this.tilesets[0];
    if (sheet !== this.sheet) { this.sheet = sheet; this.anchor = this.end = 0; if (sheet) void this.load(); }
    if (picked && this.selectedGid !== this.emittedGid) {
      this.anchor = this.end = this.selectedGid - picked.firstGid; this.filter = ''; this.revealSelection();
    }
  }
  selectSheet(gid: number): void {
    const sheet = this.tilesets.find(item => item.firstGid === gid);
    if (!sheet || sheet === this.sheet) return;
    this.sheet = sheet; this.anchor = this.end = 0;
    void this.load(); this.choose(0); this.revealSelection();
  }
  choose(index: number, extend = false): void {
    if (!this.sheet || index < 0 || index >= this.sheet.columns * this.rowCount) return;
    if (!extend) this.anchor = index;
    this.end = index;
    const { x, y, width, height } = this.selection;
    const columns = this.sheet.columns;
    const gids = Uint32Array.from({ length: width * height }, (_, i) => this.sheet!.firstGid + (y + Math.floor(i / width)) * columns + x + i % width);
    this.emittedGid = gids[0]; this.stampChange.emit({ width, height, gids });
  }
  private indexAt(event: PointerEvent): number | undefined {
    if (!this.sheet || !this.sheetGrid) return undefined;
    const rect = this.sheetGrid.nativeElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.sheet.columns - 1, Math.floor((event.clientX - rect.left) / this.tileWidth)));
    const y = Math.max(0, Math.min(this.rowCount - 1, Math.floor((event.clientY - rect.top) / this.tileHeight)));
    return y * this.sheet.columns + x;
  }
  startSelection(event: PointerEvent): void {
    if (event.button !== 0) return;
    const index = this.indexAt(event);
    if (index === undefined) return;
    event.preventDefault(); this.pointerId = event.pointerId;
    this.sheetGrid!.nativeElement.focus({ preventScroll: true });
    this.sheetGrid!.nativeElement.setPointerCapture(event.pointerId);
    this.choose(index, event.shiftKey);
  }
  moveSelection(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    const index = this.indexAt(event);
    if (index !== undefined && index !== this.end) this.choose(index, true);
  }
  endSelection(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = undefined;
    const grid = this.sheetGrid?.nativeElement;
    if (grid?.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
  }
  gridKey(event: KeyboardEvent): void {
    if (!this.sheet || event.ctrlKey || event.metaKey || event.altKey) return;
    const columns = this.sheet.columns;
    let index = this.end;
    switch (event.key) {
      case 'ArrowLeft': if (index % columns) index--; break;
      case 'ArrowRight': if (index % columns < columns - 1) index++; break;
      case 'ArrowUp': index -= columns; break;
      case 'ArrowDown': index += columns; break;
      case 'Home': index = Math.floor(index / columns) * columns; break;
      case 'End': index = Math.floor(index / columns) * columns + columns - 1; break;
      default: return;
    }
    event.preventDefault(); this.choose(Math.max(0, Math.min(this.sheet.columns * this.rowCount - 1, index)), event.shiftKey); this.revealSelection();
  }
  setZoom(zoom: number): void { if (this.zoomLevels.includes(zoom)) { this.zoom = zoom; this.revealSelection(); } }
  changeZoom(direction: number): void {
    this.setZoom(this.zoomLevels[Math.max(0, Math.min(this.zoomLevels.length - 1, this.zoomLevels.indexOf(this.zoom) + direction))]);
  }
  private revealSelection(): void {
    if (this.revealFrame !== undefined) cancelAnimationFrame(this.revealFrame);
    this.revealFrame = requestAnimationFrame(() => {
      this.revealFrame = undefined;
      const scroll = this.sheetScroll?.nativeElement;
      if (!scroll) return;
      const left = (this.end % (this.sheet?.columns ?? 1)) * this.tileWidth, top = Math.floor(this.end / (this.sheet?.columns ?? 1)) * this.tileHeight;
      if (left < scroll.scrollLeft) scroll.scrollLeft = left;
      else if (left + this.tileWidth > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = left + this.tileWidth - scroll.clientWidth;
      if (top < scroll.scrollTop) scroll.scrollTop = top;
      else if (top + this.tileHeight > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + this.tileHeight - scroll.clientHeight;
    });
  }
  private async load(): Promise<void> {
    const sheet = this.sheet!, generation = ++this.generation;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = ''; this.loading = true; this.error = ''; this.availableRows = undefined;
    try {
      const result = await this.assets.load([sheet]);
      if (generation !== this.generation) return;
      const blob = result.sheets.get(sheet.firstGid);
      if (!blob) throw new Error(result.errors.get(sheet.firstGid) || 'Tilesheet unavailable.');
      const bitmap = await createImageBitmap(blob);
      try {
        if (generation !== this.generation) return;
        const layout = tilezedSheetGeometry(sheet, bitmap.width, bitmap.height);
        if (!layout.tileCount) throw new Error(`Sheet ${sheet.name} does not contain a complete tile.`);
        const scale = sheet.tileWidth / layout.tileWidth;
        this.imageWidth = bitmap.width * scale; this.imageHeight = bitmap.height * scale;
        this.availableRows = layout.rows;
        this.anchor = Math.min(this.anchor, layout.tileCount - 1); this.end = Math.min(this.end, layout.tileCount - 1);
        this.url = URL.createObjectURL(blob);
      } finally { bitmap.close(); }
    } catch (error) { if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  ngOnDestroy(): void {
    this.generation++;
    this.changes.unsubscribe();
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.revealFrame !== undefined) cancelAnimationFrame(this.revealFrame);
  }
}
