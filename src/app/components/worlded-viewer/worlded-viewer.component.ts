import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { BuildingLots, PlacedBuildingLot } from '../../services/building-lots';
import { TilezedHandoffService } from '../../services/tilezed-handoff.service';
import { WorldedSession, WorldedSessionService } from '../../services/worlded-session.service';
import { WorldedStorageService } from '../../services/worlded-storage.service';
import { resolveWorldedProject, worldedFileFor, worldedVegetationPath } from '../../utils/worlded-files';
import { loadWorldedPreviews, WorldedTerrainImage } from '../../utils/worlded-preview';
import { drawWorldedOverview, worldedBounds, worldedCellAt, worldedProject, WorldedPoint } from '../../utils/worlded-renderer';
import { readWorldedWorld, WorldedCell, worldedCellKey } from '../../utils/worlded-world';
import {
  constrainTilezedCamera, fitTilezedCamera, TilezedCamera, TilezedViewport, zoomTilezedCamera,
} from '../../utils/tilezed-renderer';

const MAX_WORLD_FILE_BYTES = 32 * 1024 * 1024;

@Component({
  selector: 'app-worlded-viewer',
  templateUrl: './worlded-viewer.component.html',
  styleUrls: ['./worlded-viewer.component.scss'],
})
export class WorldedViewerComponent implements AfterViewInit, OnDestroy {
  @Input() hosted = false;
  @Input() minimal = false;
  @Input() projectId?: string;
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('viewport') viewportElement!: ElementRef<HTMLElement>;

  workspace?: WorldedSession;
  error = '';
  previewWarnings: string[] = [];
  loadingWorld = false;
  loadingFolder = false;
  openingCell = false;
  loadingBuildings = false;
  buildings?: BuildingLots;
  dragging = false;

  private images: WorldedTerrainImage[] = [];
  private viewport: TilezedViewport = { width: 1, height: 1 };
  private camera: TilezedCamera = { x: 0, y: 0, zoom: 1 };
  private pixelRatio = 1;
  private context: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private sessionChanges?: Subscription;
  private frame?: number;
  private fitPending = false;
  private generation = 0;
  private destroyed = false;
  private restoreWarning = '';
  private pointer?: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean };
  private readonly onWindowResize = () => this.resize();

  constructor(
    private readonly sessions: WorldedSessionService,
    private readonly storage: WorldedStorageService,
    private readonly handoff: TilezedHandoffService,
    private readonly router: Router,
    private readonly zone: NgZone,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly buildingPreviews: BuildingPreviewService,
  ) { }

  get zoomPercent(): number { return Math.round(this.camera.zoom * 100); }

  get storageWarning(): string { return this.workspace?.storageWarning ?? this.restoreWarning; }

  get selectedCell(): WorldedCell | undefined {
    const position = this.workspace?.selectedCell;
    if (!position || !this.workspace) return undefined;
    return this.workspace.world.cells.get(worldedCellKey(position.x, position.y)) ??
      { ...position, map: '', lots: [], zones: [], objectCount: 0, featureCount: 0 };
  }

  get selectedMapFile(): File | undefined {
    const cell = this.selectedCell;
    return cell && this.workspace && /\.tmx$/i.test(cell.map)
      ? worldedFileFor(this.workspace.files, cell.map)
      : undefined;
  }

  get warnings(): string[] {
    const workspace = this.workspace;
    if (!workspace) return [];
    const warnings = [...workspace.world.warnings, ...workspace.warnings, ...this.previewWarnings,
      ...(this.buildings?.warnings ?? [])];
    if (workspace.omittedResources) {
      warnings.push(`${workspace.omittedResources} project files could not be saved in the browser snapshot. ` +
        'Select the project folder again after a reload to access them.');
    }
    return [...new Set(warnings)];
  }

  ngAfterViewInit(): void {
    this.sessionChanges = this.sessions.changes$.subscribe(session => {
      if (!this.destroyed && this.workspace === session) this.changeDetector.detectChanges();
    });
    this.context = this.canvas.nativeElement.getContext('2d');
    if (!this.context) {
      this.error = 'Your browser could not create the world canvas.';
      this.changeDetector.detectChanges();
      return;
    }
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.viewportElement.nativeElement);
    }
    window.addEventListener('resize', this.onWindowResize);
    if (this.hosted) return;
    const current = this.sessions.current;
    if (current) {
      const generation = ++this.generation;
      void Promise.resolve().then(() => this.installSession(current, generation));
    } else {
      void this.restoreLastWorld();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.generation++;
    this.sessionChanges?.unsubscribe();
    this.buildings?.dispose();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.releaseImages(this.images);
  }

  async onWorldSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openWorld(file);
  }

  async openWorld(file: File): Promise<void> {
    const generation = ++this.generation;
    this.loadingFolder = false;
    if (!/\.pzw$/i.test(file.name)) {
      this.error = 'Choose a WorldEd .pzw file.';
      this.loadingWorld = false;
      return;
    }
    if (file.size > MAX_WORLD_FILE_BYTES) {
      this.error = 'Choose a world file of at most 32 MiB.';
      this.loadingWorld = false;
      return;
    }
    this.loadingWorld = true;
    this.error = '';
    try {
      const world = readWorldedWorld(await file.text());
      if (!this.isCurrent(generation)) return;
      const workspace: WorldedSession = {
        worldFile: file, world, files: new Map(), folderName: '', warnings: [],
        omittedResources: 0, restored: false,
      };
      this.restoreWarning = '';
      await Promise.all([this.installSession(workspace, generation), this.rememberWorld(workspace)]);
    } catch (error) {
      if (this.isCurrent(generation)) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.isCurrent(generation)) {
        this.loadingWorld = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  async openHosted(project: WorldedSession): Promise<void> {
    const previous = this.workspace;
    const sameSize = !!previous && previous.world.width === project.world.width &&
      previous.world.height === project.world.height && previous.world.cellSize === project.world.cellSize;
    const sameTerrain = sameSize && JSON.stringify(previous!.world.bitmaps) === JSON.stringify(project.world.bitmaps) &&
      project.world.bitmaps.every(bitmap => [bitmap.path, worldedVegetationPath(bitmap.path)].every(path =>
        worldedFileFor(previous!.files, path) === worldedFileFor(project.files, path)));
    let sameBuildings = sameSize && previous!.world.lotCount === project.world.lotCount;
    for (const [key, cell] of project.world.cells) {
      const old = previous?.world.cells.get(key);
      if (old && JSON.stringify(old.lots) === JSON.stringify(cell.lots) && cell.lots.every(lot =>
        worldedFileFor(previous!.files, lot.map) === worldedFileFor(project.files, lot.map))) {
        cell.lots = old.lots;
      } else if (cell.lots.length || old?.lots.length) { sameBuildings = false; }
    }
    this.resize();
    await this.installSession(project, ++this.generation, !!sameTerrain, !!sameBuildings, sameSize);
  }

  async onFolderSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) await this.connectProject(files);
  }

  async connectProject(files: readonly File[]): Promise<void> {
    const previous = this.workspace;
    if (!previous) {
      this.error = 'Open a .pzw world before choosing its project folder.';
      return;
    }
    const generation = ++this.generation;
    this.loadingFolder = true;
    this.error = '';
    try {
      const project = await resolveWorldedProject(files, previous.worldFile, previous.world);
      if (!this.isCurrent(generation)) return;
      const workspace: WorldedSession = {
        ...previous, files: project.files, folderName: project.folderName, warnings: project.warnings,
        omittedResources: 0, restored: false, storageWarning: undefined,
      };
      this.workspace = workspace;
      this.sessions.current = workspace;
      this.restoreWarning = '';
      this.buildings?.dispose();
      this.buildings = undefined;
      this.loadingBuildings = false;
      await Promise.all([this.loadPreviews(workspace, generation), this.rememberWorld(workspace)]);
      if (this.isCurrent(generation)) this.loadBuildings(workspace);
    } catch (error) {
      if (this.isCurrent(generation)) this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.isCurrent(generation)) {
        this.loadingFolder = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  private async restoreLastWorld(): Promise<void> {
    const generation = this.generation;
    try {
      const saved = await this.storage.lastWorld();
      if (!saved || !this.isCurrent(generation)) return;
      const world = readWorldedWorld(await saved.worldFile.text());
      if (!this.isCurrent(generation)) return;
      await this.installSession({ ...saved, world, restored: true }, generation);
    } catch (error) {
      console.error('Could not reopen the last WorldEd world:', error);
      if (this.isCurrent(generation)) {
        this.restoreWarning = `Could not reopen the last world: ${error instanceof Error ? error.message : String(error)}`;
        this.changeDetector.markForCheck();
      }
    }
  }

  private async installSession(workspace: WorldedSession, generation: number,
    keepTerrain = false, keepBuildings = false, keepCamera = false): Promise<void> {
    if (!this.isCurrent(generation)) return;
    if (!keepTerrain) { this.releaseImages(this.images); this.images = []; }
    this.workspace = workspace;
    if (!this.hosted) this.sessions.current = workspace;
    this.restoreWarning = '';
    if (!keepBuildings) this.loadBuildings(workspace);
    if (!keepCamera) this.fit();
    else this.requestDraw();
    if (!keepTerrain) {
      this.previewWarnings = [];
      await this.loadPreviews(workspace, generation);
    }
  }

  private async loadPreviews(workspace: WorldedSession, generation: number): Promise<void> {
    const previews = await loadWorldedPreviews(workspace.world, workspace.files);
    if (!this.isCurrent(generation) || this.workspace !== workspace) {
      this.releaseImages(previews.images);
      return;
    }
    this.releaseImages(this.images);
    this.images = previews.images;
    this.previewWarnings = previews.warnings;
    this.requestDraw();
    this.changeDetector.markForCheck();
  }

  private async rememberWorld(workspace: WorldedSession): Promise<void> {
    try {
      const snapshot = await this.storage.rememberWorld(workspace);
      if (this.sessions.current === workspace) {
        workspace.worldFile = snapshot.worldFile;
        for (const [path, file] of snapshot.files) workspace.files.set(path, file);
        workspace.omittedResources = snapshot.omittedResources;
        workspace.storageWarning = '';
        this.sessions.notifyChanged(workspace);
      }
    } catch (error) {
      console.error('Could not remember the WorldEd world:', error);
      if (this.sessions.current === workspace) {
        workspace.storageWarning = `Could not remember this world: ${error instanceof Error ? error.message : String(error)}`;
        this.sessions.notifyChanged(workspace);
      }
    }
  }

  async openSelectedCell(): Promise<void> {
    const cell = this.selectedCell;
    const file = this.selectedMapFile;
    if (!cell?.map) {
      this.error = 'This cell has no assigned map.';
      return;
    }
    if (!/\.tmx$/i.test(cell.map)) {
      this.error = 'Only .tmx cell maps can be opened in TileZed.';
      return;
    }
    if (!file) {
      this.error = `Cell map unavailable: ${cell.map}. Select the project folder to load it.`;
      return;
    }
    this.error = '';
    this.openingCell = true;
    const buildingContext = this.workspace ? { lots: cell.lots, files: this.workspace.files, zones: cell.zones,
      ...(this.hosted && this.projectId ? { projectId: this.projectId } : {}) } : undefined;
    this.handoff.send(file, buildingContext);
    try {
      if (!await this.router.navigate(['/tilezed'])) {
        this.handoff.clear(file);
        if (!this.destroyed) this.error = 'Could not open the cell in TileZed.';
      }
    } catch (error) {
      this.handoff.clear(file);
      console.error('Could not open the cell in TileZed:', error);
      if (!this.destroyed) this.error = `Could not open the cell in TileZed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (!this.destroyed) {
        this.openingCell = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  fit(): void {
    if (!this.workspace) return;
    // Hidden project viewers have no usable size yet. Keep the fit pending
    // until ResizeObserver measures the visible viewport.
    this.fitPending = true;
    this.resize();
  }

  zoom(factor: number, x = this.viewport.width / 2, y = this.viewport.height / 2): void {
    if (!this.workspace) return;
    this.camera = zoomTilezedCamera(this.camera, worldedBounds(this.workspace.world), this.viewport, factor, x, y);
    this.requestDraw();
  }

  onWheel(event: WheelEvent): void {
    if (!this.workspace) return;
    event.preventDefault();
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.height : 1);
    this.zoom(Math.exp(-delta * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.workspace || this.pointer || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false };
    this.dragging = true;
    this.canvas.nativeElement.focus({ preventScroll: true });
    this.canvas.nativeElement.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pointer || this.pointer.id !== event.pointerId || !this.workspace) return;
    this.camera = constrainTilezedCamera({
      ...this.camera,
      x: this.camera.x - (event.clientX - this.pointer.x) / this.camera.zoom,
      y: this.camera.y - (event.clientY - this.pointer.y) / this.camera.zoom,
    }, worldedBounds(this.workspace.world), this.viewport);
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    if (Math.hypot(event.clientX - this.pointer.startX, event.clientY - this.pointer.startY) > 5) this.pointer.moved = true;
    this.requestDraw();
  }

  onPointerEnd(event: PointerEvent): void {
    if (this.pointer?.id !== event.pointerId) return;
    const select = event.type === 'pointerup' && event.button === 0 && !this.pointer.moved;
    this.pointer = undefined;
    this.dragging = false;
    if (this.canvas.nativeElement.hasPointerCapture(event.pointerId)) this.canvas.nativeElement.releasePointerCapture(event.pointerId);
    if (select && this.workspace) {
      const rect = this.canvas.nativeElement.getBoundingClientRect();
      this.selectCell(worldedCellAt(this.workspace.world, this.camera, this.viewport,
        event.clientX - rect.left, event.clientY - rect.top));
    }
  }

  selectCell(position: WorldedPoint | undefined): void {
    if (!this.workspace) return;
    this.workspace.selectedCell = position;
    this.requestDraw();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.workspace) return;
    const world = this.workspace.world;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!this.workspace.selectedCell) {
        this.selectCell(worldedCellAt(world, this.camera, this.viewport, this.viewport.width / 2, this.viewport.height / 2) ??
          { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) });
      } else if (!event.repeat && !this.openingCell && !this.loadingFolder && !this.loadingWorld) {
        void this.openSelectedCell();
      }
      return;
    }
    if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const current = this.workspace.selectedCell ??
        worldedCellAt(world, this.camera, this.viewport, this.viewport.width / 2, this.viewport.height / 2) ??
        { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) };
      const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      this.selectCell({ x: Math.max(0, Math.min(world.width - 1, current.x + dx)),
        y: Math.max(0, Math.min(world.height - 1, current.y + dy)) });
      return;
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
      worldedBounds(world), this.viewport);
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
    if (this.workspace) {
      const bounds = worldedBounds(this.workspace.world);
      this.camera = this.fitPending
        ? fitTilezedCamera(bounds, this.viewport)
        : constrainTilezedCamera(this.camera, bounds, this.viewport);
      this.fitPending = false;
    }
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frame !== undefined || this.destroyed) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = undefined;
        if (this.context && this.workspace) {
          drawWorldedOverview(this.context, this.workspace.world, this.images, this.workspace.selectedCell,
            this.camera, this.viewport, this.pixelRatio, this.buildings?.sprites, this.buildings?.renderedLots);
        }
      });
    });
  }

  private loadBuildings(workspace: WorldedSession): void {
    this.buildings?.dispose();
    // Like WorldEd's fixed-width lot thumbnails, sized to the 256 px bitmaps the overview draws.
    const buildings = this.buildings = new BuildingLots(this.buildingPreviews, 256, 256);
    const { world } = workspace;
    const lots: PlacedBuildingLot[] = [];
    for (const cell of world.cells.values()) {
      for (const lot of cell.lots) {
        const origin = worldedProject(world,
          cell.x + (lot.x - lot.level * 3) / world.cellSize,
          cell.y + (lot.y - lot.level * 3) / world.cellSize);
        lots.push({ lot, ...origin, scale: 256 / (world.cellSize * 32) });
      }
    }
    this.loadingBuildings = lots.some(placement => workspace.files.size && placement.lot.map);
    void buildings.load(lots, workspace.files, () => {
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

  private isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.generation;
  }

  private releaseImages(images: readonly WorldedTerrainImage[]): void {
    images.forEach(image => image.bitmap.close());
  }
}
