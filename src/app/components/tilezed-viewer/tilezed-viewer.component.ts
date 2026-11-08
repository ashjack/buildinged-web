import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { DbService } from '../../services/db.service';
import { TilezedAssetsService, TilezedAssets } from '../../services/tilezed-assets.service';
import { TilezedBuildingContext, TilezedHandoffService } from '../../services/tilezed-handoff.service';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { BuildingLots } from '../../services/building-lots';
import { drawBuildingSprites, orderTilezedBuildingSprites } from '../../utils/building-preview';
import { resolveTilezedProject } from '../../utils/worlded-files';
import { TilezedStorageService } from '../../services/tilezed-storage.service';
import { readTilezedMap, TilezedTileset } from '../../utils/tilezed-map';
import {
  applyTilezedCamera, constrainTilezedCamera, drawTilezedScene, fitTilezedCamera, TilezedCamera, TilezedImage,
  TilezedViewport, tilezedBounds, zoomTilezedCamera,
} from '../../utils/tilezed-renderer';
import { indexTilezedSheets, localTilezedSheet, TilezedSheetIndex, tilezedSheetLayout, tilezedSheetName } from '../../utils/tilezed-sheets';
import { generateTilezedScene, TilezedScene } from '../../utils/tilezed-terrain';
import { drawTilezedOverlays, summarizeZones, TilezedZoneSummary } from '../../utils/tilezed-overlays';
import { WorldedZone } from '../../utils/worlded-world';

const SHOW_ZONES_KEY = 'tilezed:showZones';
const SHOW_LOTS_KEY = 'tilezed:showLotOutlines';

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
  buildings?: BuildingLots;
  loadingBuildings = false;
  loadingProject = false;
  zones: WorldedZone[] = [];
  zoneSummary: TilezedZoneSummary[] = [];
  showZones = localStorage.getItem(SHOW_ZONES_KEY) !== '0';
  showLotOutlines = localStorage.getItem(SHOW_LOTS_KEY) !== '0';
  private mapFile?: File;
  private buildingContext?: TilezedBuildingContext;

  private localSheets: TilezedSheetIndex = { files: new Map(), duplicates: [] };
  private images = new Map<number, TilezedImage>();
  private viewport: TilezedViewport = { width: 1, height: 1 };
  private camera: TilezedCamera = { x: 0, y: 0, zoom: 1 };
  private pixelRatio = 1;
  private context: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private readonly sheetsChanged: Subscription;
  private frame?: number;
  // Building loads redraw often; terrain is reused while the camera, size, scene and sheets are unchanged.
  private terrain?: {
    canvas: HTMLCanvasElement; scene: TilezedScene; images: Map<number, TilezedImage>; camera: TilezedCamera;
    width: number; height: number; pixelRatio: number;
  };
  private mapGeneration = 0;
  private sheetGeneration = 0;
  private pointer?: { id: number; x: number; y: number };
  private destroyed = false;
  private readonly onWindowResize = () => this.resize();

  constructor(
    private readonly db: DbService,
    private readonly assets: TilezedAssetsService,
    private readonly storage: TilezedStorageService,
    private readonly handoff: TilezedHandoffService,
    private readonly zone: NgZone,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly buildingPreviews: BuildingPreviewService,
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
    const incoming = this.handoff.take();
    const buildings = this.handoff.takeBuildings();
    if (incoming) {
      const generation = this.mapGeneration;
      void Promise.resolve().then(() => {
        if (!this.destroyed && generation === this.mapGeneration) return this.openMap(incoming, true, buildings);
        return undefined;
      });
    } else {
      void this.restoreLastMap();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.mapGeneration++;
    this.sheetGeneration++;
    this.sheetsChanged.unsubscribe();
    this.buildings?.dispose();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    if (this.terrain) this.terrain.canvas.width = this.terrain.canvas.height = 0;
    this.terrain = undefined;
    this.releaseImages(this.images);
  }

  async onMapSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openMap(file);
  }

  async openMap(file: File, remember = true, buildings?: TilezedBuildingContext): Promise<void> {
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
      this.mapFile = file;
      this.buildingContext = buildings ?? { lots: map.lots ?? [], files: new Map() };
      // The TMX's own object groups, then the WorldEd cell's zones, kept in level order.
      this.zones = [...(map.zones ?? []), ...(buildings?.zones ?? [])].sort((a, b) => a.level - b.level);
      this.zoneSummary = summarizeZones(this.zones);
      this.loadBuildings();
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
      if (file && !this.destroyed && generation === this.mapGeneration) {
        const buildings = await this.storage.lastBuildings(file);
        if (!this.destroyed && generation === this.mapGeneration) await this.openMap(file, false, buildings);
      }
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
      if (this.buildingContext?.lots.length || this.buildingContext?.zones?.length) {
        await this.storage.rememberMap(file, this.buildingContext);
      } else await this.storage.rememberMap(file);
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

  async onProjectSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || !this.mapFile || !this.scene || !this.buildingContext) return;
    const scene = this.scene, mapFile = this.mapFile;
    this.loadingProject = true;
    this.error = '';
    try {
      const project = await resolveTilezedProject(files, mapFile, this.buildingContext.lots);
      if (this.destroyed || this.scene !== scene) return;
      this.buildingContext = { lots: this.buildingContext.lots, files: project.files,
        ...(this.buildingContext.zones ? { zones: this.buildingContext.zones } : {}) };
      this.loadBuildings();
      project.warnings.forEach(warning => this.buildings?.warnings.add(warning));
      await this.rememberMap(mapFile, scene);
    } catch (error) {
      if (!this.destroyed && this.scene === scene) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.destroyed && this.scene === scene) {
        this.loadingProject = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  private loadBuildings(): void {
    this.buildings?.dispose();
    const buildings = this.buildings = new BuildingLots(this.buildingPreviews, undefined, undefined, sprites => {
      const ordered = orderTilezedBuildingSprites(sprites);
      if (ordered.cyclic) {
        buildings.warnings.add('Interlocking building footprints need per-tile compositing; some building overlaps may be inaccurate.');
      }
      return ordered.sprites;
    });
    if (!this.scene || !this.buildingContext) return;
    const map = this.scene.map;
    const scale = map.tileWidth / 64;
    const lots = this.buildingContext.lots.map(lot => ({
      lot, scale,
      x: map.height * map.tileWidth / 2 + (lot.x - lot.y) * map.tileWidth / 2,
      y: (lot.x + lot.y) * map.tileHeight / 2 - lot.level * 96 * scale,
    }));
    this.loadingBuildings = lots.length > 0 && this.buildingContext.files.size > 0;
    void buildings.load(lots, this.buildingContext.files, () => {
      if (!this.destroyed && this.buildings === buildings) {
        this.requestDraw();
        this.changeDetector.markForCheck();
      }
    }).finally(() => {
      if (!this.destroyed && this.buildings === buildings) {
        this.loadingBuildings = false;
        this.changeDetector.markForCheck();
      }
    });
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

  setShowZones(show: boolean): void {
    this.showZones = show;
    localStorage.setItem(SHOW_ZONES_KEY, show ? '1' : '0');
    this.requestDraw();
  }

  setShowLotOutlines(show: boolean): void {
    this.showLotOutlines = show;
    localStorage.setItem(SHOW_LOTS_KEY, show ? '1' : '0');
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
          const target = this.canvas.nativeElement;
          let terrain = this.terrain;
          if (!terrain || terrain.scene !== this.scene || terrain.images !== this.images || terrain.camera !== this.camera ||
              terrain.width !== target.width || terrain.height !== target.height || terrain.pixelRatio !== this.pixelRatio) {
            const canvas = terrain?.canvas ?? document.createElement('canvas');
            canvas.width = target.width;
            canvas.height = target.height;
            const context = canvas.getContext('2d');
            if (!context) return;
            drawTilezedScene(context, this.scene, this.images, this.camera, this.viewport, this.pixelRatio);
            terrain = this.terrain = { canvas, scene: this.scene, images: this.images, camera: this.camera,
              width: target.width, height: target.height, pixelRatio: this.pixelRatio };
          }
          this.context.setTransform(1, 0, 0, 1, 0, 0);
          this.context.globalAlpha = 1;
          this.context.drawImage(terrain.canvas, 0, 0);
          this.context.imageSmoothingEnabled = false;
          applyTilezedCamera(this.context, this.camera, this.viewport, this.pixelRatio);
          drawBuildingSprites(this.context, this.buildings?.sprites ?? [], this.camera, this.viewport);
          drawTilezedOverlays(this.context, this.scene.map, this.buildingContext?.lots ?? [], this.zones,
            this.camera, this.viewport, { lots: this.showLotOutlines, zones: this.showZones });
        }
      });
    });
  }

  private releaseImages(images: Map<number, TilezedImage>): void {
    images.forEach(image => image.bitmap.close());
  }
}
