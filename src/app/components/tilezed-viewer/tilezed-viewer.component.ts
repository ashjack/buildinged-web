import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DbService } from '../../services/db.service';
import { TilezedAssetsService, TilezedAssets } from '../../services/tilezed-assets.service';
import { TilezedBuildingContext, TilezedHandoffService } from '../../services/tilezed-handoff.service';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { BuildingLots } from '../../services/building-lots';
import { BuildingPreview, drawBuildingSprites, orderTilezedBuildingSprites, placeBuildingSprite } from '../../utils/building-preview';
import { TilezedBuildingChoice } from './tilezed-building-palette.component';
import { tilezedBuildingPlacement } from '../../utils/tilezed-building-placement';
import { resolveTilezedProject, worldedReferenceKey } from '../../utils/worlded-files';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';
import { TilezedEditDocument, TilePoint, tileLine, tileRectangle, TileStamp, TilezedTool, tilezedTileAtPixel, tilezedTilePositionAtPixel } from '../../utils/tilezed-edit';
import { NATIVE_FENCES } from '../../utils/tilezed-fence-presets';
import { FenceCell, tilezedFenceCells } from '../../utils/tilezed-fence';
import { parseTileName, readPngSize } from '../../utils/sheet-atlas';
import { tilezedTileToPixel } from '../../utils/tilezed-overlays';
import { TilezedStorageService } from '../../services/tilezed-storage.service';
import { TilezedSessionService } from '../../services/tilezed-session.service';
import { drawTilezedComposition, pickTilezedComposition, tilezedComposition, TilezedCompositionDraw } from '../../utils/tilezed-composition';
import { readTilezedMap, TilezedLayer, TilezedTileset, tilesetForGid } from '../../utils/tilezed-map';
import {
  applyTilezedCamera, constrainTilezedCamera, drawTilezedStamp, fitTilezedCamera, TilezedCamera, TilezedImage,
  TilezedViewport, tilezedBounds, zoomTilezedCamera,
} from '../../utils/tilezed-renderer';
import { indexTilezedSheets, localTilezedSheet, TilezedSheetIndex, tilezedSheetGeometry, tilezedSheetName } from '../../utils/tilezed-sheets';
import { generateTilezedScene, TilezedScene } from '../../utils/tilezed-terrain';
import { drawTilezedOverlays, summarizeZones, tilezedLotAtPixel, TilezedZoneSummary } from '../../utils/tilezed-overlays';
import { WorldedLot, WorldedZone } from '../../utils/worlded-world';
import { isTextEditing } from '../../utils/editor-shortcuts';

const SHOW_ZONES_KEY = 'tilezed:showZones';
const SHOW_LOTS_KEY = 'tilezed:showLotOutlines';
const WARNINGS_EXPANDED_KEY = 'tilezed:warningsExpanded';
const HIGHLIGHT_LEVEL_KEY = 'tilezed:highlightCurrentLevel';

@Component({
  selector: 'app-tilezed-viewer',
  templateUrl: './tilezed-viewer.component.html',
  styleUrls: ['./tilezed-viewer.component.scss'],
})
export class TilezedViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('viewport') viewportElement!: ElementRef<HTMLElement>;
  @ViewChild('buildingMenu') buildingMenu?: ElementRef<HTMLElement>;
  @ViewChild('layerDialog') layerDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('layerNameInput') layerNameInput?: ElementRef<HTMLInputElement>;
  newLayerName = '';
  layerError = '';
  contextMenu?: { x: number; y: number; projectId: string; path: string };
  editor?: TilezedEditDocument;
  tool: TilezedTool = 'pan';
  readonly toolOptions: { id: TilezedTool; label: string; key?: string; icon: string }[] = [
    { id: 'pan', label: 'Pan', icon: 'pan.svg' }, { id: 'stamp', label: 'Stamp brush', key: 'B', icon: 'stock-tool-clone.png' },
    { id: 'bucket', label: 'Bucket', key: 'F', icon: 'stock-tool-bucket-fill.png' }, { id: 'eraser', label: 'Eraser', key: 'E', icon: 'stock-tool-eraser.png' },
    { id: 'select', label: 'Rectangular select', key: 'R', icon: 'stock-tool-rect-select.png' }, { id: 'pick', label: 'Pick tile', key: 'I', icon: 'icon_eyedrop.png' },
    { id: 'fence', label: 'Draw fence', key: 'G', icon: 'fence-tool.svg' },
    { id: 'building', label: 'Place building', key: 'L', icon: 'building-tool.svg' },
  ];
  selectedBuilding?: TilezedBuildingChoice;
  preparingBuilding = false;
  private buildingCursor?: TilePoint;
  private buildingPreview?: { preview: BuildingPreview; bitmap: ImageBitmap };
  private buildingGeneration = 0;
  private readonly emptyBuildingFiles = new Map<string, File>();
  get buildingFiles(): ReadonlyMap<string, File> { return this.buildingContext?.files ?? this.emptyBuildingFiles; }
  get allLots(): WorldedLot[] { return [...(this.buildingContext?.lots ?? []), ...(this.editor?.placedLots ?? [])]; }
  get canPlaceBuildings(): boolean {
    return this.auth.isAdmin && !!this.editor && !this.loadingMap && !this.saving && this.editUid === this.auth.user?.uid &&
      (!this.hostedMap || !!this.buildingContext?.cell);
  }
  readonly fences = NATIVE_FENCES;
  fenceIndex = 0;
  preparingFence = false;
  private fenceTiles = new Map<string, number>();
  private fenceGeneration = 0;
  private fenceStart?: TilePoint;
  private fenceCursor?: TilePoint;
  private fenceModifiers = { alt: false, ctrl: false };
  private pickRequest = 0;
  activeLayer = '';
  highlightCurrentLevel = localStorage.getItem(HIGHLIGHT_LEVEL_KEY) === '1';
  get currentLevel(): number { return Number(/^(\d+)_/.exec(this.activeLayer)?.[1] ?? 0); }
  private get onlyLevel(): number | undefined { return this.highlightCurrentLevel ? this.currentLevel : undefined; }
  stamp: TileStamp = { width: 1, height: 1, gids: new Uint32Array(1) };
  hoverTile?: TilePoint;
  saving = false;
  message = '';
  private editPointer?: { id: number; start: TilePoint; last: TilePoint; selecting: boolean };
  private spaceDown = false;
  private editUid?: string;

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
  warningsExpanded = localStorage.getItem(WARNINGS_EXPANDED_KEY) === '1';
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
  private readonly assetChanges: Subscription;
  private frame?: number;
  // Building loads redraw often; terrain is reused while the camera, size, scene and sheets are unchanged.
  private terrain?: {
    canvas: HTMLCanvasElement; commands: TilezedCompositionDraw[]; buildings?: BuildingLots; buildingRevision: number;
    scene: TilezedScene; images: Map<number, TilezedImage>; camera: TilezedCamera;
    width: number; height: number; pixelRatio: number;
    onlyLevel?: number;
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
    public readonly auth: AuthService,
    private readonly router: Router,
    private readonly api: ProjectApiService,
    private readonly sessions: TilezedSessionService,
  ) {
    this.assetChanges = this.assets.changes$?.subscribe(names => {
      if (!this.scene) return;
      void this.reloadSheets();
      void this.buildings?.refresh(names, () => { this.requestDraw(); this.changeDetector.markForCheck(); });
      if (this.selectedBuilding && this.canPlaceBuildings) void this.chooseBuilding(this.selectedBuilding);
    }) ?? new Subscription();
    this.sheetsChanged = this.db.sheetsChanged.subscribe(names => {
      const changed = new Set(names.map(name => name.toLowerCase()));
      if (this.scene?.usedSheets.some(({ tileset }) =>
        changed.has(tileset.name.toLowerCase()) || changed.has(tilezedSheetName(tileset.source)))) void this.reloadSheets();
    });
  }

  get zoomPercent(): number { return Math.round(this.camera.zoom * 100); }
  get warningCount(): number {
    return Number(!!this.storageWarning) + (this.buildings?.warnings.size ?? 0) + this.tileWarnings.length +
      this.sheetIssues.length + this.duplicateSheets.length + (this.scene?.warnings.length ?? 0);
  }
  toggleWarnings(): void {
    this.warningsExpanded = !this.warningsExpanded;
    localStorage.setItem(WARNINGS_EXPANDED_KEY, this.warningsExpanded ? '1' : '0');
  }
  get dirty(): boolean { return !!this.editor?.dirty; }
  get layerOptions(): TilezedLayer[] { return this.scene?.map.layers.slice().reverse() ?? []; }
  get canEdit(): boolean { return this.auth.isAdmin && !!this.editor && !!this.activeLayer && !this.loadingMap && !this.saving && this.editUid === this.auth.user?.uid; }
  get hostedMap(): boolean { return !!this.buildingContext?.projectId; }
  get selectedTileLabel(): string {
    const gid = this.stamp.gids.find(gid => gid !== 0);
    const sheet = gid && this.scene?.map.tilesets.find(sheet => gid >= sheet.firstGid && gid < sheet.firstGid + sheet.columns * sheet.rows);
    return sheet && gid ? `${sheet.name}_${String(gid - sheet.firstGid).padStart(3, '0')}` : 'Choose a tile';
  }
  get worldLink(): string[] {
    return this.buildingContext?.projectId ? ['/worlded/project', this.buildingContext.projectId] : ['/worlded'];
  }
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
    this.assetChanges.unsubscribe();
    this.buildings?.dispose();
    this.clearBuildingBrush();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    if (this.terrain) this.terrain.canvas.width = this.terrain.canvas.height = 0;
    this.terrain = undefined;
    this.releaseImages(this.images);
  }

  @HostListener('window:focus') async checkTileUpdates(): Promise<void> {
    if (!this.scene || this.destroyed || !this.assets.checkForUpdates) return;
    try { await this.assets.checkForUpdates(); }
    catch { /* Keep the current images when metadata is temporarily unavailable. */ }
  }

  async onMapSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openMap(file);
  }

  async openMap(file: File, remember = true, buildings?: TilezedBuildingContext): Promise<void> {
    if (!this.canLeave()) return;
    this.closeContextMenu();
    const generation = ++this.mapGeneration;
    if (!/\.tmx$/i.test(file.name)) {
      this.error = 'Choose a TileZed .tmx file.';
      this.loadingMap = false;
      return;
    }
    this.loadingMap = true;
    this.error = '';
    try {
      const xml = await file.text();
      const map = await readTilezedMap(xml);
      if (this.destroyed || generation !== this.mapGeneration) return;
      const scene = generateTilezedScene(map);
      if (this.destroyed || generation !== this.mapGeneration) return;
      this.sheetGeneration++;
      this.releaseImages(this.images);
      this.images = new Map();
      this.pickRequest++;
      this.clearBuildingBrush();
      this.fenceGeneration++;
      this.fenceStart = this.fenceCursor = undefined;
      this.fenceTiles.clear(); this.preparingFence = false;
      this.editor = new TilezedEditDocument(xml, scene);
      this.scene = this.editor.scene;
      this.activeLayer = map.layers.find(layer => layer.visible && layer.opacity)?.name ?? '';
      this.stamp = { width: 1, height: 1, gids: new Uint32Array(1) };
      this.tool = 'pan';
      this.hoverTile = undefined;
      this.editPointer = undefined;
      this.editUid = this.auth.user?.uid;
      this.message = '';
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
      const saving = remember ? this.rememberMap(file, this.scene) : Promise.resolve();
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
      const hosted = await this.sessions.restore();
      if (this.destroyed || generation !== this.mapGeneration) return;
      if (hosted) { await this.openMap(hosted.file, false, hosted.buildings); return; }
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
      if (this.buildingContext?.projectId) { this.sessions.remember(this.buildingContext); return; }
      if (this.buildingContext?.lots.length || this.buildingContext?.zones?.length) {
        await this.storage.rememberMap(file, this.buildingContext);
      } else await this.storage.rememberMap(file);
      if (this.scene === scene) this.sessions.remember();
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
      this.buildingContext = { ...this.buildingContext, lots: this.buildingContext.lots, files: project.files,
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
      if (ordered.cyclic && sprites.some(sprite => !sprite.composition)) {
        buildings.warnings.add('Interlocking building footprints need per-tile compositing; some building overlaps may be inaccurate.');
      }
      return ordered.sprites;
    }, true);
    if (!this.scene || !this.buildingContext) return;
    const map = this.scene.map;
    const scale = map.tileWidth / 64;
    const lots = this.allLots.map(lot => ({
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

  private syncBuildingPlacements(): void {
    if (!this.scene || !this.buildingContext || !this.buildings) return;
    const map = this.scene.map, scale = map.tileWidth / 64, buildings = this.buildings;
    const lots = this.allLots.map(lot => ({ lot, scale,
      x: map.height * map.tileWidth / 2 + (lot.x - lot.y) * map.tileWidth / 2,
      y: (lot.x + lot.y) * map.tileHeight / 2 - lot.level * 96 * scale }));
    void buildings.sync(lots, this.buildingContext.files, () => {
      if (!this.destroyed && this.buildings === buildings) { this.requestDraw(); this.changeDetector.markForCheck(); }
    });
  }
  private clearBuildingBrush(): void {
    this.buildingGeneration++;
    this.buildingPreview?.bitmap.close(); this.buildingPreview = undefined;
    this.selectedBuilding = undefined; this.buildingCursor = undefined; this.preparingBuilding = false;
  }
  async chooseBuilding(choice: TilezedBuildingChoice): Promise<void> {
    if (!this.canPlaceBuildings || this.buildingFiles.get(choice.path) !== choice.file) return;
    this.clearBuildingBrush();
    const generation = this.buildingGeneration;
    this.selectedBuilding = choice; this.preparingBuilding = true;
    this.setTool('building'); this.error = '';
    try {
      const preview = await this.buildingPreviews.preview(choice.file, 0, 2048);
      if (generation !== this.buildingGeneration || this.destroyed) return;
      const bitmap = await createImageBitmap(preview.blob);
      if (generation !== this.buildingGeneration || this.destroyed) { bitmap.close(); return; }
      this.buildingPreview = { preview, bitmap };
    } catch (error) {
      if (generation === this.buildingGeneration) this.error = `Could not preview this building: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (generation === this.buildingGeneration) { this.preparingBuilding = false; this.requestDraw(); this.changeDetector.markForCheck(); }
    }
  }
  private hoverBuilding(): WorldedLot | undefined {
    if (!this.selectedBuilding || !this.buildingCursor || !this.buildingPreview || !this.canPlaceBuildings ||
      !this.editor?.contains({ x: Math.floor(this.buildingCursor.x), y: Math.floor(this.buildingCursor.y) })) return undefined;
    return tilezedBuildingPlacement(this.selectedBuilding, this.buildingCursor);
  }

  private async reloadSheets(): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    const generation = ++this.sheetGeneration;
    const localSheets = this.localSheets;
    const required = new Map(scene.usedSheets.map(item => [item.tileset.firstGid, { ...item }]));
    if (this.tool === 'stamp' || this.tool === 'fence') for (const gid of this.tool === 'fence' ? this.fenceTiles.values() : this.stamp.gids) {
      const tileset = gid ? tilesetForGid(scene.map.tilesets, gid) : undefined;
      if (!tileset) continue;
      const item = required.get(tileset.firstGid);
      if (item) item.maxIndex = Math.max(item.maxIndex, gid - tileset.firstGid);
      else required.set(tileset.firstGid, { tileset, maxIndex: gid - tileset.firstGid });
    }
    const images = new Map<number, TilezedImage>();
    const issues: string[] = [];
    this.loadingSheets = true;

    const needed: TilezedTileset[] = [];
    for (const { tileset } of required.values()) {
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

    for (const { tileset, maxIndex } of required.values()) {
      if (this.destroyed || generation !== this.sheetGeneration) break;
      try {
        const blob = localTilezedSheet(localSheets, tileset) ?? resolved.sheets.get(tileset.firstGid);
        if (!blob) {
          issues.push(resolved.errors.get(tileset.firstGid) ?? `${tileset.name}: sheet not found`);
          continue;
        }
        const bitmap = await createImageBitmap(blob);
        try {
          const layout = tilezedSheetGeometry(tileset, bitmap.width, bitmap.height);
          images.set(tileset.firstGid, { bitmap, layout });
          if (maxIndex >= layout.tileCount) {
            const missing = new Set<number>();
            for (const layer of scene.layers) {
              if (!layer.visible || !layer.opacity) continue;
              for (const gid of layer.gids) {
                const index = gid - tileset.firstGid;
                if (index >= layout.tileCount && index < tileset.columns * tileset.rows) missing.add(index);
              }
            }
            const indexes = [...missing].sort((a, b) => a - b);
            if (indexes.length) issues.push(`${tileset.name}: ${indexes.length} referenced tile(s) unavailable in the image (${indexes.slice(0, 8).join(', ')}${indexes.length > 8 ? ', …' : ''}). Available tiles are still shown.`);
          }
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
    this.closeContextMenu();
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
    this.closeContextMenu();
    this.showLotOutlines = show;
    localStorage.setItem(SHOW_LOTS_KEY, show ? '1' : '0');
    this.requestDraw();
  }

  zoom(factor: number, x = this.viewport.width / 2, y = this.viewport.height / 2): void {
    this.closeContextMenu();
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
    if (this.canEdit) this.hoverTile = this.tileAtEvent(event);
    if (this.tool === 'building') this.buildingCursor = this.fractionalTileAtEvent(event);
  }

  onPointerDown(event: PointerEvent): void {
    this.closeContextMenu();
    if (this.saving || this.loadingMap) return;
    if (event.button === 0 && !this.spaceDown && this.tool === 'building' && this.canPlaceBuildings) {
      event.preventDefault(); this.canvas.nativeElement.focus({ preventScroll: true });
      this.buildingCursor = this.fractionalTileAtEvent(event);
      const lot = this.hoverBuilding();
      if (lot) { this.editor!.placeBuilding(lot); this.syncBuildingPlacements(); }
      this.requestDraw(); return;
    }
    if (event.button === 0 && !this.spaceDown && !['pan', 'building'].includes(this.tool) && this.canEdit && this.editor) {
      event.preventDefault();
      this.canvas.nativeElement.focus({ preventScroll: true });
      const point = this.tileAtEvent(event);
      if (this.tool === 'pick') { void this.pickAtEvent(event); return; }
      if (!this.editor.contains(point)) return;
      if (this.tool === 'fence') {
        if (this.preparingFence || !this.fenceTiles.size) return;
        this.fenceCursor = this.fractionalTileAtEvent(event);
        this.fenceModifiers = { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey };
        if (this.fenceModifiers.alt || this.fenceModifiers.ctrl) {
          this.editor.paintCells(this.activeLayer, this.fenceCells()); this.updateEditedScene(true); return;
        }
        this.fenceStart = this.fenceCursor;
        this.editPointer = { id: event.pointerId, start: point, last: point, selecting: false };
        this.canvas.nativeElement.setPointerCapture(event.pointerId); this.requestDraw(); return;
      }
      if (this.tool === 'bucket') {
        this.editor.fill(this.activeLayer, point, this.stamp, event.shiftKey);
        this.updateEditedScene(true); return;
      }
      this.editPointer = { id: event.pointerId, start: point, last: point, selecting: this.tool === 'select' };
      this.canvas.nativeElement.setPointerCapture(event.pointerId);
      if (this.tool === 'select') this.editor.selection = tileRectangle(point, point);
      else { this.editor.begin(this.activeLayer); this.paintTile(point); }
      this.updateEditedScene();
      return;
    }
    if (!this.scene || this.pointer || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.dragging = true;
    this.canvas.nativeElement.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.scene && this.tool === 'building' && this.canPlaceBuildings) {
      this.buildingCursor = this.fractionalTileAtEvent(event); this.requestDraw();
    }
    if (this.scene && this.canEdit) {
      this.hoverTile = this.tileAtEvent(event);
      if (this.tool === 'fence') {
        const map = this.scene.map, position = this.fractionalTileAtEvent(event);
        this.fenceCursor = { x: Math.max(0, Math.min(map.width - 0.001, position.x)), y: Math.max(0, Math.min(map.height - 0.001, position.y)) };
        this.fenceModifiers = { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey };
        this.requestDraw();
        if (this.editPointer?.id === event.pointerId) return;
      }
      if (this.editPointer?.id === event.pointerId && this.editor) {
        if (this.editPointer.selecting) {
          const map = this.scene.map;
          const point = { x: Math.max(0, Math.min(map.width - 1, this.hoverTile.x)), y: Math.max(0, Math.min(map.height - 1, this.hoverTile.y)) };
          this.editor.selection = tileRectangle(this.editPointer.start, point);
        } else {
          const point = { x: Math.max(-1, Math.min(this.scene.map.width, this.hoverTile.x)), y: Math.max(-1, Math.min(this.scene.map.height, this.hoverTile.y)) };
          for (const tile of tileLine(this.editPointer.last, point)) this.paintTile(tile);
          this.editPointer.last = point;
        }
        this.updateEditedScene();
        return;
      }
      this.requestDraw();
    }
    if (!this.pointer || this.pointer.id !== event.pointerId || !this.scene) return;
    this.camera = constrainTilezedCamera({
      ...this.camera,
      x: this.camera.x - (event.clientX - this.pointer.x) / this.camera.zoom,
      y: this.camera.y - (event.clientY - this.pointer.y) / this.camera.zoom,
    }, tilezedBounds(this.scene.map), this.viewport);
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    if (this.canEdit) this.hoverTile = this.tileAtEvent(event);
    if (this.tool === 'building') this.buildingCursor = this.fractionalTileAtEvent(event);
    this.requestDraw();
  }

  onPointerLeave(): void { this.hoverTile = undefined; this.buildingCursor = undefined; if (!this.fenceStart) this.fenceCursor = undefined; this.requestDraw(); }

  onPointerEnd(event: PointerEvent): void {
    if (this.editPointer?.id === event.pointerId) {
      if (this.tool === 'fence' && this.fenceStart) {
        if (event.type === 'pointerup' && this.canEdit) {
          const point = this.fractionalTileAtEvent(event), map = this.scene!.map;
          this.fenceCursor = { x: Math.max(0, Math.min(map.width - 0.001, point.x)), y: Math.max(0, Math.min(map.height - 0.001, point.y)) };
          this.editor!.paintCells(this.activeLayer, this.fenceCells());
        }
        this.fenceStart = undefined;
      }
      this.finishEditing();
      if (this.canvas.nativeElement.hasPointerCapture(event.pointerId)) this.canvas.nativeElement.releasePointerCapture(event.pointerId);
      return;
    }
    if (this.pointer?.id !== event.pointerId) return;
    this.pointer = undefined;
    this.dragging = false;
    if (this.scene && this.canEdit) this.hoverTile = this.tileAtEvent(event);
    if (this.canvas.nativeElement.hasPointerCapture(event.pointerId)) this.canvas.nativeElement.releasePointerCapture(event.pointerId);
    this.requestDraw();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.highlightLevelKey(event)) return;
    if (!this.scene) return;
    if (this.canEdit || (this.tool === 'building' && this.canPlaceBuildings)) {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 's') { event.preventDefault(); void this.saveMap(); return; }
      if (ctrl && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); this.history(event.key.toLowerCase() === 'y' || event.shiftKey); return;
      }
      if (ctrl && event.key.toLowerCase() === 'c' && this.editor?.selection) { event.preventDefault(); this.captureSelection(); return; }
      if (ctrl && event.key.toLowerCase() === 'v') { event.preventDefault(); this.setTool('stamp'); return; }
      if (event.key === ' ') { event.preventDefault(); this.spaceDown = true; this.requestDraw(); return; }
      if (event.key === 'Escape') { this.fenceStart = undefined; this.finishEditing(); this.editor!.selection = undefined; if (this.tool === 'building') this.setTool('pan'); this.requestDraw(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.eraseSelection(); return; }
      const shortcuts: Record<string, TilezedTool> = { b: 'stamp', f: 'bucket', e: 'eraser', r: 'select', i: 'pick', g: 'fence', l: 'building' };
      if (!ctrl && shortcuts[event.key.toLowerCase()]) { event.preventDefault(); this.setTool(shortcuts[event.key.toLowerCase()]); return; }
    }
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

  private tileAtEvent(event: MouseEvent): TilePoint {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    return tilezedTileAtPixel(this.scene!.map, this.camera, this.viewport, event.clientX - rect.left, event.clientY - rect.top);
  }
  private fractionalTileAtEvent(event: MouseEvent): TilePoint {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    return tilezedTilePositionAtPixel(this.scene!.map, this.camera, this.viewport, event.clientX - rect.left, event.clientY - rect.top);
  }
  private paintTile(point: TilePoint): void {
    if (this.tool === 'eraser') this.editor!.erase(point);
    else this.editor!.stamp(point, this.stamp);
  }
  setTool(tool: TilezedTool): void {
    if (tool === 'building' && !this.canPlaceBuildings) return;
    this.pickRequest++;
    this.fenceStart = undefined;
    this.finishEditing(); this.closeContextMenu(); this.tool = tool; this.requestDraw();
    if (tool === 'fence') void this.prepareFence();
    if (tool === 'stamp' && this.scene && this.stamp.gids.some(gid => {
      const sheet = gid ? tilesetForGid(this.scene!.map.tilesets, gid) : undefined;
      return sheet && !this.images.has(sheet.firstGid);
    })) void this.reloadSheets();
  }
  selectLayer(name: string): void {
    this.fenceStart = undefined;
    this.finishEditing(); this.activeLayer = name; this.requestDraw();
  }
  moveLayer(direction: 'up' | 'down'): void {
    if (!this.canEdit || !this.editor?.canMoveLayer(this.activeLayer, direction)) return;
    this.finishEditing(); this.closeContextMenu();
    this.editor.moveLayer(this.activeLayer, direction);
    this.updateEditedScene();
  }
  showAddLayer(): void {
    if (!this.canEdit || !this.editor?.canAddLayer) return;
    this.finishEditing(); this.closeContextMenu();
    this.newLayerName = this.editor.suggestedLayerName(); this.layerError = '';
    this.changeDetector.detectChanges();
    this.layerDialog?.nativeElement.showModal();
    this.layerNameInput?.nativeElement.focus(); this.layerNameInput?.nativeElement.select();
  }
  closeAddLayer(): void { this.layerDialog?.nativeElement.close(); this.layerError = ''; }
  addLayer(event?: Event): void {
    event?.preventDefault();
    if (!this.canEdit || !this.editor) return;
    try {
      this.activeLayer = this.editor.addLayer(this.newLayerName);
      this.updateEditedScene(); this.closeAddLayer();
      this.canvas.nativeElement.focus({ preventScroll: true });
    } catch (error) { this.layerError = error instanceof Error ? error.message : String(error); }
  }
  chooseStamp(stamp: TileStamp): void { this.stamp = stamp; this.setTool('stamp'); }
  async pickAtEvent(event: MouseEvent): Promise<void> {
    const request = ++this.pickRequest, editor = this.editor, generation = this.mapGeneration;
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = this.camera.x + (event.clientX - rect.left - this.viewport.width / 2) / this.camera.zoom;
    const y = this.camera.y + (event.clientY - rect.top - this.viewport.height / 2) / this.camera.zoom;
    try {
      const commands = tilezedComposition(this.scene!, this.images, this.buildings?.compositionSprites ?? [], this.camera, this.viewport, this.onlyLevel);
      const hit = pickTilezedComposition(commands, x, y);
      const buildingTile = hit?.sheet !== undefined ? { sheet: hit.sheet, index: hit.index! }
        : hit?.building ? await this.buildings?.pickTile(x, y) : undefined;
      if (request !== this.pickRequest || editor !== this.editor || generation !== this.mapGeneration || !this.canEdit || this.tool !== 'pick') return;
      const gid = buildingTile ? await this.ensureTileSheet(buildingTile.sheet, buildingTile.index) : hit?.gid;
      if (request !== this.pickRequest || editor !== this.editor || generation !== this.mapGeneration || this.destroyed || !this.canEdit || this.tool !== 'pick') return;
      if (!gid) { this.message = 'There is no visible tile under the cursor.'; return; }
      if (hit?.gid) this.activeLayer = hit.layer;
      this.message = ''; this.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(gid) });
    } catch (error) { if (request === this.pickRequest) this.message = `Could not pick tile: ${error instanceof Error ? error.message : String(error)}`; }
    finally { this.changeDetector.markForCheck(); }
  }

  private async ensureTileSheet(name: string, index: number): Promise<number> {
    const editor = this.editor!;
    const map = editor.scene.map;
    const existing = map.tilesets.find(sheet => tilezedSheetName(sheet.name) === name);
    if (existing && index < existing.columns * existing.rows) return existing.firstGid + index;
    if (existing) throw new Error(`${name} tile ${index} is outside this map's tileset range.`);
    const width = map.tileWidth, height = width * 2;
    const candidate: TilezedTileset = { name, source: `Tiles/${name}.png`, firstGid: 1, tileWidth: width, tileHeight: height,
      columns: 8, rows: Math.ceil((index + 1) / 8), imageWidth: width * 8, imageHeight: Math.ceil((index + 1) / 8) * height };
    const local = localTilezedSheet(this.localSheets, candidate);
    const resolved = local ? undefined : await this.assets.load([candidate]);
    const blob = local ?? resolved?.sheets.get(1);
    if (!blob) throw new Error(resolved?.errors.get(1) ?? `Sheet ${name} is unavailable.`);
    const size = readPngSize(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
    if (!size) throw new Error(`Sheet ${name} is not a PNG.`);
    candidate.rows = Math.floor(size.height / (height * (size.width / (8 * width))));
    const geometry = tilezedSheetGeometry(candidate, size.width, size.height);
    if (index >= geometry.tileCount) throw new Error(`Sheet ${name} does not contain tile ${index}.`);
    if (editor !== this.editor || this.destroyed) throw new Error('The map changed while loading the tile.');
    const concurrent = map.tilesets.find(sheet => tilezedSheetName(sheet.name) === name);
    if (concurrent) return concurrent.firstGid + index;
    candidate.firstGid = Math.max(1, ...map.tilesets.map(sheet => sheet.firstGid + sheet.columns * sheet.rows));
    candidate.imageHeight = candidate.rows * height;
    map.tilesets.push(candidate);
    this.scene = { ...editor.scene }; this.changeDetector.markForCheck();
    return candidate.firstGid + index;
  }

  async prepareFence(): Promise<void> {
    this.fenceStart = undefined; this.finishEditing();
    const generation = ++this.fenceGeneration, editor = this.editor, preset = this.fences[this.fenceIndex];
    if (!editor || !preset) return;
    this.preparingFence = true; this.fenceTiles = new Map();
    const tiles = new Map<string, number>();
    const groups = new Map<string, { role: string; index: number }[]>();
    for (const [role, reference] of Object.entries(preset)) {
      if (role === 'label' || !reference) continue;
      const parsed = parseTileName(reference); if (!parsed) continue;
      const entries = groups.get(parsed.sheet) ?? []; entries.push({ role, index: parsed.index }); groups.set(parsed.sheet, entries);
    }
    const missing: string[] = [];
    try {
      for (const [name, entries] of groups) {
        try {
          const max = Math.max(...entries.map(item => item.index));
          const gid = await this.ensureTileSheet(name, max);
          entries.forEach(item => tiles.set(item.role, gid - max + item.index));
        } catch { missing.push(name); }
      }
      if (generation !== this.fenceGeneration || editor !== this.editor || this.tool !== 'fence') return;
      this.fenceTiles = tiles;
      this.message = missing.length ? `Some fence tiles are unavailable: ${missing.join(', ')}.` : '';
      await this.reloadSheets();
    } finally { if (generation === this.fenceGeneration) { this.preparingFence = false; this.requestDraw(); this.changeDetector.markForCheck(); } }
  }
  private fenceCells(): FenceCell[] {
    if (!this.editor || !this.fenceCursor) return [];
    const layer = this.scene!.layers.find(layer => layer.name === this.activeLayer)!;
    return tilezedFenceCells(this.fenceTiles, this.fenceStart ?? this.fenceCursor, this.fenceStart ? this.fenceCursor : undefined,
      point => this.editor!.contains(point) ? layer.gids[point.y * this.scene!.map.width + point.x] : 0, this.fenceModifiers);
  }
  captureSelection(): void {
    if (!this.canEdit) return;
    const stamp = this.editor?.capture(this.activeLayer);
    if (!stamp || !stamp.gids.some(gid => gid)) { this.message = 'The selection has no tiles on this layer.'; return; }
    this.stamp = stamp;
    this.editor!.selection = undefined;
    this.setTool('stamp');
  }
  eraseSelection(): void {
    if (!this.canEdit) return;
    this.editor?.eraseSelection(this.activeLayer);
    this.updateEditedScene(true);
  }
  clearSelection(): void { if (this.editor) this.editor.selection = undefined; this.requestDraw(); }
  history(redo = false): void {
    if (!this.canEdit && !this.canPlaceBuildings) return;
    this.finishEditing();
    const previousLayers = new Set(this.editor!.scene.map.layers.map(layer => layer.name));
    redo ? this.editor!.redo() : this.editor!.undo();
    const restored = this.editor!.scene.map.layers.find(layer => !previousLayers.has(layer.name));
    if (restored) this.activeLayer = restored.name;
    else if (!this.editor!.scene.map.layers.some(layer => layer.name === this.activeLayer)) {
      this.activeLayer = this.editor!.scene.map.layers.filter(layer => layer.visible && layer.opacity).at(-1)?.name ?? '';
    }
    this.updateEditedScene(true);
    this.syncBuildingPlacements();
  }
  private finishEditing(): void {
    this.fenceStart = undefined;
    this.editor?.finish();
    if (this.editPointer) {
      const id = this.editPointer.id;
      this.editPointer = undefined;
      if (this.canvas.nativeElement.hasPointerCapture(id)) this.canvas.nativeElement.releasePointerCapture(id);
      this.updateEditedScene(true);
    }
  }
  private updateEditedScene(sheets = false): void {
    if (!this.editor) return;
    const previous = this.scene!.usedSheets;
    this.scene = { ...this.editor.scene };
    if (sheets) {
      const used = new Map<number, { tileset: TilezedTileset; maxIndex: number }>();
      for (const layer of this.scene.layers) {
        if (!layer.visible || !layer.opacity) continue;
        for (const gid of layer.gids) {
          if (!gid) continue;
          const tileset = tilesetForGid(this.scene.map.tilesets, gid)!;
          const item = used.get(tileset.firstGid);
          if (item) item.maxIndex = Math.max(item.maxIndex, gid - tileset.firstGid);
          else used.set(tileset.firstGid, { tileset, maxIndex: gid - tileset.firstGid });
        }
      }
      this.editor.scene.usedSheets = this.scene.usedSheets = [...used.values()];
      if (this.loadingSheets || this.scene.usedSheets.some(item => !previous.some(prior => prior.tileset === item.tileset && prior.maxIndex >= item.maxIndex))) void this.reloadSheets();
    }
    this.message = '';
    this.requestDraw();
  }

  @HostListener('document:keyup', ['$event']) releasePanKey(event: KeyboardEvent): void {
    if (event.code === 'Space' || event.key === ' ') { this.spaceDown = false; this.requestDraw(); }
  }
  @HostListener('window:blur') onWindowBlur(): void {
    this.spaceDown = false; this.hoverTile = undefined; this.buildingCursor = undefined; this.finishEditing(); this.closeContextMenu(); this.requestDraw();
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty || this.saving) { event.preventDefault(); event.returnValue = ''; }
  }
  canLeave(): boolean {
    if (this.saving) { window.alert('Wait for the map save to finish.'); return false; }
    return !this.dirty || window.confirm('Leave without saving your TileZed edits? Unsaved changes will be discarded.');
  }
  async saveMap(): Promise<void> {
    if ((!this.canEdit && !this.canPlaceBuildings) || !this.editor) return;
    this.finishEditing();
    const editor = this.editor, context = this.buildingContext, uid = this.auth.user?.uid;
    if (context?.projectId && (!context.mapPath || !Number.isSafeInteger(context.worldRevision))) {
      this.error = 'Reopen this cell from the project world before saving to the project. Your current edits can be exported.';
      return;
    }
    this.saving = true; this.error = ''; this.message = 'Saving map…';
    try {
      const xml = await editor.serialize(!context?.projectId);
      await readTilezedMap(xml);
      if (editor !== this.editor || uid !== this.auth.user?.uid || !this.auth.isAdmin) throw new Error('Your account changed. The map was not saved.');
      const file = new File([xml], this.fileName, { type: 'application/xml' });
      if (context?.projectId) {
        if (editor.placementsDirty && !context.cell) throw new Error('Reopen this cell from WorldEd before saving building placements.');
        const placements = editor.placementsDirty ? { cell: context.cell!, lots: this.allLots } : undefined;
        const result = placements
          ? await this.api.saveWorldMap(context.projectId, worldedReferenceKey(context.mapPath!)!, xml, context.worldRevision!, placements)
          : await this.api.saveWorldMap(context.projectId, worldedReferenceKey(context.mapPath!)!, xml, context.worldRevision!);
        if (this.destroyed || editor !== this.editor || uid !== this.auth.user?.uid) return;
        context.worldRevision = result.revision;
        context.files = new Map(context.files).set(worldedReferenceKey(context.mapPath!)!, file);
      } else {
        this.downloadMap(file);
        try {
          if (this.allLots.length || context?.zones?.length) await this.storage.rememberMap(file, { ...context!, lots: this.allLots });
          else await this.storage.rememberMap(file);
        } catch { this.storageWarning = 'The TMX download was created, but the browser could not remember the saved map.'; }
      }
      this.mapFile = file;
      editor.markSaved();
      this.message = context?.projectId ? 'Map saved to the shared project.' : 'TMX download created.';
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); this.message = 'Save failed. Your unsaved edits are still open.'; }
    finally { this.saving = false; }
  }
  async exportMap(): Promise<void> {
    if (!this.editor || this.saving || this.editPointer) return;
    try { this.downloadMap(new File([await this.editor.serialize()], this.fileName, { type: 'application/xml' })); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }
  private downloadMap(file: File): void {
    const url = URL.createObjectURL(file), link = document.createElement('a');
    link.href = url; link.download = file.name; link.style.display = 'none'; document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
  }
  private drawEditOverlay(context: CanvasRenderingContext2D): void {
    if (!this.auth.isAdmin || !this.scene || !this.editor) return;
    const rectangle = (x: number, y: number, width: number, height: number, color: string) => {
      context.beginPath();
      for (const [i, point] of [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].entries()) {
        const [px, py] = tilezedTileToPixel(this.scene!.map, point[0], point[1], 0);
        i ? context.lineTo(px, py) : context.moveTo(px, py);
      }
      context.closePath(); context.fillStyle = color; context.fill(); context.strokeStyle = '#8ac7ff'; context.stroke();
    };
    context.save(); context.lineWidth = 1.5 / this.camera.zoom;
    const selection = this.editor.selection;
    if (selection) rectangle(selection.x, selection.y, selection.width, selection.height, '#3c99ee35');
    const point = this.hoverTile;
    const lot = this.tool === 'building' && !this.spaceDown && !this.dragging ? this.hoverBuilding() : undefined;
    if (lot && this.buildingPreview) {
      const map = this.scene.map, scale = map.tileWidth / 64;
      const [x, y] = tilezedTileToPixel(map, lot.x, lot.y, lot.level);
      const sprite = placeBuildingSprite(this.buildingPreview.bitmap, this.buildingPreview.preview, lot, x, y, scale);
      context.save(); context.globalAlpha = 0.5;
      drawBuildingSprites(context, [sprite], this.camera, this.viewport); context.restore();
      rectangle(lot.x, lot.y, lot.width, lot.height, '#80c8ff20');
    }
    if (this.tool === 'fence' && this.canEdit && !this.spaceDown && !this.dragging && (point || this.fenceStart)) {
      for (const cell of this.fenceCells()) {
        if (cell.gid) drawTilezedStamp(context, this.scene.map, this.images, { width: 1, height: 1, gids: Uint32Array.of(cell.gid) }, cell.point, selection);
        rectangle(cell.point.x, cell.point.y, 1, 1, '#00ff0018');
      }
    }
    if (point && this.editor.contains(point) && !['pan', 'pick', 'fence', 'building'].includes(this.tool) && this.canEdit && !this.spaceDown && !this.dragging) {
      const width = this.tool === 'stamp' ? this.stamp.width : 1, height = this.tool === 'stamp' ? this.stamp.height : 1;
      if (this.tool === 'stamp') {
        const opacity = this.scene.layers.find(layer => layer.name === this.activeLayer)?.opacity ?? 1;
        drawTilezedStamp(context, this.scene.map, this.images, this.stamp, point, selection, 0.65 * opacity);
      }
      rectangle(point.x, point.y, width, height, this.tool === 'eraser' ? '#ff555540' : this.tool === 'stamp' ? '#ffffff00' : '#ffffff20');
    }
    context.restore();
  }

  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (this.tool === 'building') { this.setTool('pan'); return; }
    if (this.tool === 'fence' && this.fenceStart) { this.fenceStart = undefined; this.finishEditing(); this.requestDraw(); return; }
    this.closeContextMenu();
    const projectId = this.buildingContext?.projectId;
    if (!this.auth.isAdmin || !projectId || !this.scene || !this.showLotOutlines || this.loadingMap) return;
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const lot = tilezedLotAtPixel(this.scene.map, this.allLots, this.camera, this.viewport,
      event.clientX - rect.left, event.clientY - rect.top);
    const path = lot && worldedReferenceKey(lot.map);
    if (!path || !/\.tbx$/i.test(path) || !this.buildingContext!.files.has(path)) return;
    this.contextMenu = { x: event.clientX, y: event.clientY, projectId, path };
    this.changeDetector.detectChanges();
    const menu = this.buildingMenu?.nativeElement;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    this.contextMenu.x = Math.max(0, Math.min(event.clientX, document.documentElement.clientWidth - bounds.width));
    this.contextMenu.y = Math.max(0, Math.min(event.clientY, window.innerHeight - bounds.height));
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }

  closeContextMenu(restoreFocus = false): void {
    if (!this.contextMenu) return;
    this.contextMenu = undefined;
    if (restoreFocus) this.canvas.nativeElement.focus({ preventScroll: true });
  }

  @HostListener('document:pointerdown', ['$event']) dismissContextMenu(event: PointerEvent): void {
    if (!this.buildingMenu?.nativeElement.contains(event.target as Node)) this.closeContextMenu();
  }

  private highlightLevelKey(event: KeyboardEvent): boolean {
    if (!this.scene || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTextEditing(event)
      || this.layerDialog?.nativeElement.open || event.key.toLowerCase() !== 'h') return false;
    event.preventDefault();
    if (!event.repeat) {
      this.highlightCurrentLevel = !this.highlightCurrentLevel;
      localStorage.setItem(HIGHLIGHT_LEVEL_KEY, this.highlightCurrentLevel ? '1' : '0');
      this.pickRequest++;
      this.requestDraw();
    }
    return true;
  }

  @HostListener('document:keydown', ['$event']) contextMenuKey(event: KeyboardEvent): void {
    if (this.highlightLevelKey(event)) return;
    if (this.layerDialog?.nativeElement.open) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && this.tool === 'building') {
      event.preventDefault(); this.setTool('pan'); this.canvas.nativeElement.focus({ preventScroll: true }); return;
    }
    if (!this.contextMenu && event.target !== this.canvas?.nativeElement && this.canEdit &&
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); void this.saveMap(); return;
    }
    if (!this.contextMenu) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.closeContextMenu(true);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(this.buildingMenu?.nativeElement.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }

  async editContextBuilding(): Promise<void> {
    const menu = this.contextMenu;
    this.closeContextMenu(true);
    if (!menu || !this.auth.isAdmin || menu.projectId !== this.buildingContext?.projectId) return;
    try {
      if (!await this.router.navigate(['/projects', menu.projectId, 'world-buildings', menu.path, 'edit'])) {
        this.error = 'Could not open the building editor. Try again.';
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  async createTaskFromContextBuilding(): Promise<void> {
    const menu = this.contextMenu;
    this.closeContextMenu(true);
    if (!menu || !this.auth.isAdmin || menu.projectId !== this.buildingContext?.projectId) return;
    try {
      if (!await this.router.navigate(['/projects', menu.projectId, 'tasks', 'new'], { queryParams: { worldBuilding: menu.path } })) {
        this.error = 'Could not open the task creation page. Try again.';
      }
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }

  private resize(): void {
    this.closeContextMenu();
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
              terrain.onlyLevel !== this.onlyLevel ||
              terrain.buildings !== this.buildings || terrain.buildingRevision !== (this.buildings?.revision ?? 0) ||
              terrain.width !== target.width || terrain.height !== target.height || terrain.pixelRatio !== this.pixelRatio) {
            const canvas = terrain?.canvas ?? document.createElement('canvas');
            canvas.width = target.width;
            canvas.height = target.height;
            const context = canvas.getContext('2d');
            if (!context) return;
            const commands = tilezedComposition(this.scene, this.images, this.buildings?.compositionSprites ?? [], this.camera, this.viewport, this.onlyLevel);
            drawTilezedComposition(context, commands, this.camera, this.viewport, this.pixelRatio);
            terrain = this.terrain = { canvas, commands, buildings: this.buildings, buildingRevision: this.buildings?.revision ?? 0,
              scene: this.scene, images: this.images, camera: this.camera,
              width: target.width, height: target.height, pixelRatio: this.pixelRatio, onlyLevel: this.onlyLevel };
          }
          this.context.setTransform(1, 0, 0, 1, 0, 0);
          this.context.globalAlpha = 1;
          this.context.drawImage(terrain.canvas, 0, 0);
          this.context.imageSmoothingEnabled = false;
          applyTilezedCamera(this.context, this.camera, this.viewport, this.pixelRatio);
          drawTilezedOverlays(this.context, this.scene.map,
            this.allLots.filter(lot => this.onlyLevel === undefined || lot.level === this.onlyLevel),
            this.zones.filter(zone => this.onlyLevel === undefined || zone.level === this.onlyLevel),
            this.camera, this.viewport, { lots: this.showLotOutlines, zones: this.showZones });
          this.drawEditOverlay(this.context);
        }
      });
    });
  }

  private releaseImages(images: Map<number, TilezedImage>): void {
    images.forEach(image => image.bitmap.close());
  }
}
