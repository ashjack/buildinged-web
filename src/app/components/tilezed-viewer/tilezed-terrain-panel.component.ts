import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TerrainTool, TilezedTerrainTools } from '../../utils/tilezed-terrain-tools';

@Component({
  selector: 'app-tilezed-terrain-panel', standalone: true, imports: [CommonModule],
  template: `
    <div class="tools" role="toolbar" aria-label="Terrain tools">
      <button *ngFor="let item of tools" type="button" [class.active]="terrain.tool === item.id" [attr.aria-pressed]="terrain.tool === item.id"
        [attr.aria-label]="item.label" [title]="item.label" (click)="chooseTool(item.id)"><img [src]="'assets/tilezed-tools/' + item.icon" alt=""></button>
    </div>
    <div class="tabs" role="tablist" aria-label="BMP tools">
      <button *ngFor="let name of tabs" type="button" role="tab" [attr.aria-selected]="tab === name" (click)="tab = name">{{name}}</button>
    </div>
    <section *ngIf="tab === 'Rules'" aria-label="Terrain rules">
      <div class="channels" role="group" aria-label="Terrain bitmap">
        <button type="button" [class.active]="terrain.bitmap === 0" [attr.aria-pressed]="terrain.bitmap === 0" (click)="terrain.chooseBitmap(0); changed.emit()">Ground</button>
        <button type="button" [class.active]="terrain.bitmap === 1" [attr.aria-pressed]="terrain.bitmap === 1" (click)="terrain.chooseBitmap(1); changed.emit()">Vegetation</button>
      </div>
      <input type="search" aria-label="Filter terrain rules" placeholder="Filter terrain rules" [value]="filter" (input)="filter = $any($event.target).value">
      <div class="rules" role="listbox" aria-label="Terrain colour">
        <button *ngFor="let rule of colors" type="button" role="option" [attr.aria-selected]="terrain.color === rule.color" [class.active]="terrain.color === rule.color"
          [title]="rule.label + ' · ' + hex(rule.color)" (click)="terrain.color = rule.color; changed.emit()">
          <span class="swatch" [style.background]="hex(rule.color)"></span><span>{{rule.label || 'Empty'}}<small>{{hex(rule.color)}}</small></span>
        </button>
      </div>
      <p *ngIf="!terrain.colors.length">This map has no {{terrain.bitmap ? 'vegetation' : 'ground'}} rules. Import Rules.txt in Options to add a terrain palette.</p>
    </section>
    <section *ngIf="tab === 'Blends'" class="blends" aria-label="Terrain blends">
      <p *ngIf="!terrain.map.blends.length">This map has no blend definitions. Import Blends.txt in Options.</p>
      <div *ngFor="let blend of terrain.map.blends"><strong>{{blend.main}} → {{blend.tile}}</strong><small>{{blend.layer}} · {{blend.direction.toUpperCase()}}</small></div>
    </section>
    <section *ngIf="tab === 'Options'" class="options" aria-label="Terrain options">
      <label><input type="checkbox" [checked]="terrain.restrict" (change)="terrain.restrict = $any($event.target).checked; changed.emit()"> Restrict drawing to selected area</label>
      <label><input type="checkbox" [checked]="terrain.fillAll" (change)="terrain.fillAll = $any($event.target).checked"> Bucket: fill all matching in selected area</label>
      <label><input type="checkbox" [checked]="showBmp" (change)="showBmp = $any($event.target).checked; displayChanged.emit({bmp: showBmp, map: showMap, overlays: showOverlays})"> Show BMP-generated tiles</label>
      <label><input type="checkbox" [checked]="showMap" (change)="showMap = $any($event.target).checked; displayChanged.emit({bmp: showBmp, map: showMap, overlays: showOverlays})"> Show map tiles</label>
      <label><input type="checkbox" [checked]="showOverlays" (change)="showOverlays = $any($event.target).checked; displayChanged.emit({bmp: showBmp, map: showMap, overlays: showOverlays})"> Show FloorOverlay layers</label>
      <label><input type="checkbox" [checked]="terrain.map.blendEdgesEverywhere" (change)="edgesChanged.emit($any($event.target).checked)"> Blend edges everywhere</label>
      <div class="files"><strong>Rules.txt</strong><button type="button" (click)="rulesInput.click()">Import</button><button type="button" (click)="exportSettings.emit('rules')">Export</button></div>
      <div class="files"><strong>Blends.txt</strong><button type="button" (click)="blendsInput.click()">Import</button><button type="button" (click)="exportSettings.emit('blends')">Export</button></div>
      <input #rulesInput type="file" accept=".txt,text/plain" hidden (change)="importFile($event, 'rules')">
      <input #blendsInput type="file" accept=".txt,text/plain" hidden (change)="importFile($event, 'blends')">
    </section>
    <div class="brush-options">
      <label>Brush size <input type="number" min="1" max="300" step="1" aria-label="Terrain brush size" [value]="terrain.size" (input)="setSize($event)"></label>
      <div class="channels" role="group" aria-label="Terrain brush shape">
        <button type="button" [class.active]="terrain.shape === 'square'" (click)="terrain.shape = 'square'; changed.emit()">Square</button>
        <button type="button" [class.active]="terrain.shape === 'circle'" (click)="terrain.shape = 'circle'; changed.emit()">Circle</button>
        <button type="button" [class.active]="terrain.shape === 'custom'" (click)="maskInput.click()">PNG mask</button>
      </div>
      <input #maskInput type="file" accept="image/png,.png" hidden (change)="loadMask($event)">
      <small *ngIf="terrain.shape === 'custom' && terrain.custom">Mask: {{terrain.custom.width}} × {{terrain.custom.height}}</small>
    </div>
    <div class="selection-actions"><button type="button" [disabled]="!terrain.selection.size" (click)="terrain.copy(); changed.emit()">Copy</button>
      <button type="button" [disabled]="!terrain.clipboard" (click)="terrain.startPaste(); changed.emit()">Paste</button>
      <button type="button" [disabled]="!terrain.selection.size" (click)="terrain.eraseSelection(); changed.emit()">Erase</button>
      <button type="button" [disabled]="!terrain.selection.size" (click)="terrain.selection.clear(); changed.emit()">Clear selection</button></div>
    <p class="help" role="status">{{help}}</p><p class="error" *ngIf="error" role="alert">{{error}}</p>
  `,
  styles: [`
    :host{display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;background:#f4f4f4;color:#222}
    button,input{font:inherit;color:#222;color-scheme:light}input{background:#fff;border:1px solid #aaa;border-radius:2px}button{border:1px solid #aaa;background:#eee;border-radius:2px;padding:5px;cursor:pointer}button:hover{background:#e0eaf6}button:disabled{opacity:.5;cursor:default}button.active{background:#bcdcff;border-color:#4c91d0}
    .tools{display:flex;flex-wrap:wrap;gap:3px;padding:6px;border-bottom:1px solid #aaa}.tools button{width:30px;height:30px;padding:3px}.tools img{width:22px;height:22px}
    .tabs,.channels{display:flex;gap:3px}.tabs{padding:5px;border-bottom:1px solid #aaa}.tabs button,.channels button{flex:1}.tabs [aria-selected=true]{background:#fff;border-bottom-color:#fff}
    section{min-height:0;overflow:auto;flex:1;padding:7px}section>input[type=search]{box-sizing:border-box;width:100%;margin:7px 0;padding:5px}.rules button{display:flex;align-items:center;gap:8px;text-align:left;width:100%;margin-bottom:3px;overflow-wrap:anywhere}.swatch{display:block;width:28px;height:28px;flex-shrink:0;border:1px solid #555}small{display:block;color:#555;font-size:11px}.options label{display:block;margin-bottom:12px}.files{display:flex;align-items:center;gap:6px;margin:12px 0}.files strong{flex:1}.brush-options{padding:8px;border-top:1px solid #aaa}.brush-options label{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.brush-options input{width:65px;padding:4px}.blends div{padding:6px 0;border-bottom:1px solid #ccc;overflow-wrap:anywhere}.selection-actions{display:flex;gap:3px;padding:0 7px}.help,.error{padding:7px;margin:0;font-size:11px;line-height:1.5}.error{color:#a21b16}
  `],
})
export class TilezedTerrainPanelComponent {
  @Input() terrain!: TilezedTerrainTools;
  @Input() activeLayer = '';
  @Output() changed = new EventEmitter<void>();
  @Output() edgesChanged = new EventEmitter<boolean>();
  @Output() displayChanged = new EventEmitter<{ bmp: boolean; map: boolean; overlays: boolean }>();
  @Output() importSettings = new EventEmitter<{ kind: 'rules' | 'blends'; text: string }>();
  @Output() exportSettings = new EventEmitter<'rules' | 'blends'>();
  readonly tabs = ['Rules', 'Blends', 'Options'];
  tab = 'Rules'; filter = ''; error = '';
  @Input() showBmp = true;
  @Input() showMap = true;
  @Input() showOverlays = true;
  readonly tools: { id: TerrainTool; label: string; icon: string }[] = [
    { id: 'brush', label: 'Terrain brush (B)', icon: 'bmp-tool.png' },
    { id: 'rectangle', label: 'Terrain rectangle (R)', icon: 'bmp-rect.png' },
    { id: 'bucket', label: 'Terrain bucket (F)', icon: 'bmp-bucket.png' },
    { id: 'select', label: 'Terrain selection (S)', icon: 'bmp-select.png' },
    { id: 'wand', label: 'Terrain magic wand (W)', icon: 'bmp-wand.png' },
    { id: 'eraser', label: 'Terrain eraser (E)', icon: 'bmp-eraser.png' },
    { id: 'bake', label: 'Bake terrain to tile layers (K)', icon: 'bmp-to-layers.png' },
    { id: 'no-blend', label: 'Toggle terrain blending (N)', icon: 'bmp-no-blend.png' },
    { id: 'pick', label: 'Pick terrain colour (I)', icon: 'icon_eyedrop.png' },
  ];
  get colors() { return this.terrain.colors.filter(item => item.label.toLowerCase().includes(this.filter.toLowerCase())); }
  hex(color: number): string { return '#' + color.toString(16).padStart(6, '0'); }
  chooseTool(tool: TerrainTool): void { this.terrain.setTool(tool); this.changed.emit(); }
  setSize(event: Event): void { this.terrain.size = Math.max(1, Math.min(300, Math.floor(Number((event.target as HTMLInputElement).value)) || 1)); this.changed.emit(); }
  get help(): string {
    if (this.terrain.pasting) return 'Click to paste both bitmaps. Right-click or Escape to cancel.';
    if (['select', 'wand'].includes(this.terrain.tool)) return 'Ctrl: add · Shift: subtract · Ctrl+Shift: intersect. Drag inside selection to move; hold Ctrl while dragging to copy, Shift for both bitmaps.';
    if (this.terrain.tool === 'no-blend') return this.terrain.map.blends.some(blend => blend.layer === this.activeLayer)
      ? 'Drag to toggle blending on the active blend layer. Shift affects all blend layers.' : 'Choose a layer targeted by a blend definition in the Layer control before using Prevent Blending.';
    if (this.terrain.tool === 'bake') return 'Paint to turn generated terrain into regular map tiles. Clears both bitmaps under the brush.';
    return 'Drag to paint · Ctrl: erase · Shift: square rectangle · [ / ]: brush size. Ctrl+C / Ctrl+V copies and pastes both bitmaps.';
  }
  async importFile(event: Event, kind: 'rules' | 'blends'): Promise<void> {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (file) this.importSettings.emit({ kind, text: await file.text() });
  }
  async loadMask(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    let image: ImageBitmap | undefined;
    try {
      image = await createImageBitmap(file);
      if (image.width > 300 || image.height > 300) throw new Error('Brush masks must be at most 300 × 300 pixels.');
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height).data, pixels = new Uint8Array(image.width * image.height);
      for (let i = 0; i < pixels.length; i++) pixels[i] = data[i * 4 + 3] >= 32 && Math.floor((11 * data[i * 4] + 16 * data[i * 4 + 1] + 5 * data[i * 4 + 2]) / 32) <= 127 ? 1 : 0;
      if (!pixels.some(Boolean)) throw new Error('The PNG has no dark, opaque brush pixels.');
      this.terrain.custom = { width: image.width, height: image.height, pixels }; this.terrain.shape = 'custom'; this.error = ''; this.changed.emit();
    } catch (error) { this.error = error instanceof Error ? error.message : 'Could not read this PNG brush.'; }
    finally { image?.close(); }
  }
}
