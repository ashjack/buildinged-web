import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DbService } from '../../services/db.service';
import { TilezedAssetsService, TilezedAssets } from '../../services/tilezed-assets.service';
import { TilezedStorageService } from '../../services/tilezed-storage.service';
import { readTilezedMap, TilezedTileset } from '../../utils/tilezed-map';
import {
  constrainTilezedCamera, drawTilezedScene, fitTilezedCamera, TilezedCamera, TilezedImage,
  TilezedViewport, tilezedBounds, zoomTilezedCamera,
} from '../../utils/tilezed-renderer';
import { indexTilezedSheets, localTilezedSheet, TilezedSheetIndex, tilezedSheetLayout, tilezedSheetName } from '../../utils/tilezed-sheets';
import { generateTilezedScene, TilezedScene } from '../../utils/tilezed-terrain';

@Component({
  selector: 'app-tilezed-viewer',
  templateUrl: './tilezed-viewer.component.html',
  styleUrls: ['./tilezed-viewer.component.scss'],
})
export class TilezedViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('viewport') viewportElement!: ElementRef<HTMLElement>;

  scene?: TilezedScene;
  fileName = '';
  folderName = '';
  error = '';
  storageWarning = '';
  tileWarnings: string[] = [];
  sheetIssues: string[] = [];
  loadingMap = false;
  loadingSheets = false;
  dragging = false;
  restoredMap = false;

  private localSheets: TilezedSheetIndex = { files: new Map(), duplicates: [] };
  private images = new Map<number, TilezedImage>();
  private viewport: TilezedViewport = { width: 1, height: 1 };
  private camera: TilezedCamera = { x: 0, y: 0, zoom: 1 };
  private pixelRatio = 1;
  private context: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private readonly sheetsChanged: Subscription;
  private frame?: number;
  private mapGeneration = 0;
  private sheetGeneration = 0;
  private pointer?: { id: number; x: number; y: number };
  private destroyed = false;
  private readonly onWindowResize = () => this.resize();

  constructor(
    private readonly db: DbService,
    private readonly assets: TilezedAssetsService,
    private readonly storage: TilezedStorageService,
    private readonly zone: NgZone,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    this.sheetsChanged = this.db.sheetsChanged.subscribe(names => {
      const changed = new Set(names.map(name => name.toLowerCase()));
      if (this.scene?.usedSheets.some(({ tileset }) =>
        changed.has(tileset.name.toLowerCase()) || changed.has(tilezedSheetName(tileset.source)))) void this.reloadSheets();
    });
  }

  get zoomPercent(): number { return Math.round(this.camera.zoom * 100); }
  get duplicateSheets(): string[] {
    const needed = new Set(this.scene?.usedSheets.flatMap(({ tileset }) =>
      [tileset.name.toLowerCase(), tilezedSheetName(tileset.source)]) ?? []);
    return this.localSheets.duplicates.filter(name => needed.has(name));
  }

  ngAfterViewInit(): void {
    this.context = this.canvas.nativeElement.getContext('2d');
    if (!this.context) {
      this.error = 'Your browser could not create the map canvas.';
      this.changeDetector.detectChanges();
      return;
    }
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.viewportElement.nativeElement);
    }
    window.addEventListener('resize', this.onWindowResize);
    void this.restoreLastMap();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.mapGeneration++;
    this.sheetGeneration++;
    this.sheetsChanged.unsubscribe();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.releaseImages(this.images);
  }

  async onMapSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openMap(file);
  }

  async openMap(file: File, remember = true): Promise<void> {
    const generation = ++this.mapGeneration;
    if (!/\.tmx$/i.test(file.name)) {
      this.error = 'Choose a TileZed .tmx file.';
      this.loadingMap = false;
      return;
    }
    this.loadingMap = true;
    this.error = '';
    try {
      const map = await readTilezedMap(await file.text());
      if (this.destroyed || generation !== this.mapGeneration) return;
      const scene = generateTilezedScene(map);
      if (this.destroyed || generation !== this.mapGeneration) return;
      this.sheetGeneration++;
      this.releaseImages(this.images);
      this.images = new Map();
      this.scene = scene;
      this.fileName = file.name;
      this.restoredMap = !remember;
      this.storageWarning = '';
      this.tileWarnings = [];
      this.sheetIssues = [];
      this.fit();
      const saving = remember ? this.rememberMap(file, scene) : Promise.resolve();
      await Promise.all([this.reloadSheets(), saving]);
    } catch (error) {
      if (!this.destroyed && generation === this.mapGeneration) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (!this.destroyed && generation === this.mapGeneration) this.loadingMap = false;
    }
  }

  private async restoreLastMap(): Promise<void> {
    const generation = this.mapGeneration;
    try {
      const file = await this.storage.lastMap();
      if (file && !this.destroyed && generation === this.mapGeneration) await this.openMap(file, false);
    } catch (error) {
      console.error('Could not reopen the last TileZed map:', error);
      if (!this.destroyed && generation === this.mapGeneration) {
        this.storageWarning = `Could not reopen the last map: ${error instanceof Error ? error.message : String(error)}`;
        this.changeDetector.markForCheck();
      }
    }
  }

  private async rememberMap(file: File, scene: TilezedScene): Promise<void> {
    try {
      await this.storage.rememberMap(file);
    } catch (error) {
      console.error('Could not remember the TileZed map:', error);
      if (!this.destroyed && this.scene === scene) {
        this.storageWarning = `Could not remember this map: ${error instanceof Error ? error.message : String(error)}`;
        this.changeDetector.markForCheck();
      }
    }
  }

  async onTilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    const indexed = indexTilezedSheets(files);
    if (!indexed.files.size) {
      this.error = 'The selected folder does not contain PNG tilesheets.';
      return;
    }
    this.error = '';
    this.localSheets = indexed;
    this.folderName = files[0].webkitRelativePath.split(/[\\/]/)[0] || 'Selected tiles';
    await this.reloadSheets();
  }

  private async reloadSheets(): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    const generation = ++this.sheetGeneration;
    const localSheets = this.localSheets;
    const images = new Map<number, TilezedImage>();
    const issues: string[] = [];
    this.loadingSheets = true;

    const needed: TilezedTileset[] = [];
    for (const { tileset } of scene.usedSheets) {
      if (!localTilezedSheet(localSheets, tileset)) needed.push(tileset);
    }

    let resolved: TilezedAssets = { sheets: new Map(), errors: new Map(), warnings: [] };
    if (needed.length) {
      try {
        resolved = await this.assets.load(needed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        for (const tileset of needed) resolved.errors.set(tileset.firstGid, `${tileset.name}: ${detail}`);
      }
    }

    for (const { tileset, maxIndex } of scene.usedSheets) {
      if (this.destroyed || generation !== this.sheetGeneration) break;
      try {
        const blob = localTilezedSheet(localSheets, tileset) ?? resolved.sheets.get(tileset.firstGid);
        if (!blob) {
          issues.push(resolved.errors.get(tileset.firstGid) ?? `${tileset.name}: sheet not found`);
          continue;
        }
        const bitmap = await createImageBitmap(blob);
        try {
          const layout = tilezedSheetLayout(tileset, maxIndex, bitmap.width, bitmap.height);
          images.set(tileset.firstGid, { bitmap, layout });
        } catch (error) {
          bitmap.close();
          throw error;
        }
      } catch (error) {
        issues.push(`${tileset.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.destroyed || generation !== this.sheetGeneration || this.scene !== scene) {
      this.releaseImages(images);
      return;
    }
    this.releaseImages(this.images);
    this.images = images;
    this.sheetIssues = issues;
    this.tileWarnings = resolved.warnings;
    this.loadingSheets = false;
    this.requestDraw();
    this.changeDetector.markForCheck();
  }

  fit(): void {
    if (!this.scene) return;
    this.camera = fitTilezedCamera(tilezedBounds(this.scene.map), this.viewport);
    this.requestDraw();
  }

  zoom(factor: number, x = this.viewport.width / 2, y = this.viewport.height / 2): void {
    if (!this.scene) return;
    this.camera = zoomTilezedCamera(this.camera, tilezedBounds(this.scene.map), this.viewport, factor, x, y);
    this.requestDraw();
  }

  onWheel(event: WheelEvent): void {
    if (!this.scene) return;
    event.preventDefault();
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.height : 1);
    this.zoom(Math.exp(-delta * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.scene || this.pointer || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.dragging = true;
    this.canvas.nativeElement.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pointer || this.pointer.id !== event.pointerId || !this.scene) return;
    this.camera = constrainTilezedCamera({
      ...this.camera,
      x: this.camera.x - (event.clientX - this.pointer.x) / this.camera.zoom,
      y: this.camera.y - (event.clientY - this.pointer.y) / this.camera.zoom,
    }, tilezedBounds(this.scene.map), this.viewport);
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    this.requestDraw();
  }

  onPointerEnd(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    this.pointer = undefined;
    this.dragging = false;
    if (this.canvas.nativeElement.hasPointerCapture(event.pointerId)) this.canvas.nativeElement.releasePointerCapture(event.pointerId);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.scene) return;
    const distance = 80 / this.camera.zoom;
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft': dx = -distance; break;
      case 'ArrowRight': dx = distance; break;
      case 'ArrowUp': dy = -distance; break;
      case 'ArrowDown': dy = distance; break;
      case '+': case '=': event.preventDefault(); this.zoom(1.25); return;
      case '-': case '_': event.preventDefault(); this.zoom(1 / 1.25); return;
      case 'Home': event.preventDefault(); this.fit(); return;
      default: return;
    }
    event.preventDefault();
    this.camera = constrainTilezedCamera({ ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy },
      tilezedBounds(this.scene.map), this.viewport);
    this.requestDraw();
  }

  private resize(): void {
    if (!this.canvas) return;
    const canvas = this.canvas.nativeElement;
    const rect = this.viewportElement.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.viewport = { width: rect.width, height: rect.height };
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * this.pixelRatio);
    const height = Math.round(rect.height * this.pixelRatio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (this.scene) this.camera = constrainTilezedCamera(this.camera, tilezedBounds(this.scene.map), this.viewport);
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frame !== undefined || this.destroyed) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = undefined;
        if (this.context && this.scene) {
          drawTilezedScene(this.context, this.scene, this.images, this.camera, this.viewport, this.pixelRatio);
        }
      });
    });
  }

  private releaseImages(images: Map<number, TilezedImage>): void {
    images.forEach(image => image.bitmap.close());
  }
}
