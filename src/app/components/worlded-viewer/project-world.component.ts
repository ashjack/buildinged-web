import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService, ProjectRequestError } from '../../services/project-api.service';
import { ProjectWorldDocument, ProjectWorldService } from '../../services/project-world.service';
import { WorldedSavedProject } from '../../services/worlded-storage.service';
import { resolveWorldedProject } from '../../utils/worlded-files';
import { readWorldedWorld } from '../../utils/worlded-world';
import { WorldedViewerComponent } from './worlded-viewer.component';

@Component({
  selector: 'app-project-world',
  templateUrl: './project-world.component.html',
  styleUrls: ['./project-world.component.scss'],
})
export class ProjectWorldComponent implements AfterViewInit, OnDestroy {
  @ViewChild(WorldedViewerComponent) viewer!: WorldedViewerComponent;
  @ViewChild('controlsToggle') controlsToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('controlsPanel') controlsPanel?: ElementRef<HTMLElement>;
  controlsOpen = false;
  projectId = this.route.snapshot.paramMap.get('projectId')!;
  projectName = '';
  cloud?: ProjectWorldDocument;
  document?: Document;
  cell?: Element;
  files = new Map<string, File>();
  pending?: WorldedSavedProject;
  busy = false;
  dirty = false;
  ready = false;
  error = '';
  message = '';
  progress = '';
  syncMessage = '';
  private syncTimer?: ReturnType<typeof setInterval>;
  private syncing = false;
  private destroyed = false;
  private authChanges?: Subscription;
  private routeChanges?: Subscription;

  constructor(private route: ActivatedRoute, public auth: AuthService,
    private api: ProjectApiService, private worlds: ProjectWorldService, private zone: NgZone,
    private changeDetector: ChangeDetectorRef) { }

  toggleControls(): void {
    this.controlsOpen = !this.controlsOpen;
    this.changeDetector.detectChanges();
    if (this.controlsOpen) this.controlsPanel?.nativeElement.focus({ preventScroll: true });
    else this.controlsToggle?.nativeElement.focus({ preventScroll: true });
  }
  @HostListener('document:keydown.escape')
  closeControls(): void { if (this.controlsOpen) this.toggleControls(); }

  get isAdmin(): boolean { return this.auth.isAdmin; }
  get zoomPercent(): number { return this.viewer?.zoomPercent ?? 100; }
  get cacheWarning(): string { return this.worlds.cacheWarning; }
  get lots(): Element[] { return this.children('lot'); }
  get zones(): Element[] { return this.children('object'); }
  get mapPaths(): string[] { return [...this.files.keys()].filter(path => /\.tmx$/i.test(path)); }
  get lotPaths(): string[] { return [...this.files.keys()].filter(path => /\.(tbx|tmx)$/i.test(path)); }
  get groups(): string[] {
    return Array.from(this.document?.documentElement.children ?? [])
      .filter(element => element.tagName === 'objectgroup').map(element => this.attr(element, 'name'));
  }
  attr(element: Element, name: string): string { return element.getAttribute(name) ?? ''; }
  private children(name: string): Element[] {
    return Array.from(this.cell?.children ?? []).filter(element => element.tagName === name);
  }

  ngAfterViewInit(): void {
    const uid = this.auth.user?.uid;
    this.authChanges = this.auth.user$.subscribe(user => {
      if (user?.uid !== uid || !this.auth.canViewWorlds) {
        this.ready = false;
        this.document = this.cell = undefined;
        this.files.clear();
        this.cloud = undefined;
        this.error = 'Your account changed. Reopen this world from the project.';
      }
    });
    this.routeChanges = this.route.paramMap.subscribe(params => {
      const projectId = params.get('projectId');
      if (!projectId || projectId === this.projectId) return;
      this.projectId = projectId;
      this.controlsOpen = false;
      this.ready = this.dirty = false;
      this.document = this.cell = undefined;
      this.cloud = this.pending = undefined;
      this.files = new Map();
      void this.load();
    });
    void Promise.resolve().then(() => this.load());
    this.zone.runOutsideAngular(() => {
      this.syncTimer = setInterval(() => {
        if (document.visibilityState === 'visible') this.zone.run(() => void this.sync());
      }, 30000);
    });
  }
  ngOnDestroy(): void {
    this.destroyed = true; this.authChanges?.unsubscribe(); this.routeChanges?.unsubscribe();
    if (this.syncTimer) clearInterval(this.syncTimer);
  }
  @HostListener('window:focus')
  onFocus(): void { void this.sync(); }
  async sync(): Promise<void> {
    if (!this.ready || this.busy || this.syncing || !this.auth.user) return;
    const uid = this.auth.user.uid;
    const projectId = this.projectId;
    this.syncing = true;
    try {
      const cloud = await this.worlds.world(projectId);
      if (this.destroyed || uid !== this.auth.user?.uid || projectId !== this.projectId || this.busy) return;
      if (!cloud) throw new ProjectRequestError('The uploaded world is no longer available.', 404);
      if (cloud.revision <= (this.cloud?.revision ?? 0)) { this.syncMessage = ''; return; }
      if (this.dirty) {
        this.syncMessage = 'A newer world is available. Your unsaved edits are kept; load the latest cloud world when you are ready.';
        return;
      }
      await this.run(async () => {
        await this.installCloud(cloud);
        this.syncMessage = 'Updated to the latest world. Unchanged files were reused.';
      });
    } catch (error) {
      if (this.destroyed || uid !== this.auth.user?.uid || projectId !== this.projectId) return;
      if (error instanceof ProjectRequestError && [401, 403, 404].includes(error.status)) {
        this.ready = false;
        this.document = this.cell = undefined;
        this.cloud = undefined;
        this.files = new Map();
        this.error = error.message;
      } else { this.syncMessage = 'Could not check for world updates. Your current world and edits are kept; synchronization will retry.'; }
    } finally { this.syncing = false; }
  }
  canLeave(): boolean { return !this.busy && (!this.dirty || window.confirm('Leave without saving your world edits?')); }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty || this.busy) { event.preventDefault(); event.returnValue = ''; }
  }

  async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = this.message = '';
    try { await action(); }
    catch (error) { if (!this.destroyed) this.error = error instanceof Error ? error.message : String(error); }
    finally { if (!this.destroyed) { this.busy = false; this.progress = ''; } }
  }
  async load(): Promise<void> {
    if (this.dirty && !window.confirm('Discard your unsaved edits and load the latest cloud world?')) return;
    await this.run(async () => {
      const uid = this.auth.user?.uid;
      const projectId = this.projectId;
      const [project, cloud] = await Promise.all([this.api.project(projectId), this.worlds.world(projectId)]);
      if (this.destroyed || uid !== this.auth.user?.uid || projectId !== this.projectId) return;
      this.projectName = project.name;
      if (cloud && this.ready && !this.dirty && cloud.revision === this.cloud?.revision) {
        this.message = 'The world is already up to date.';
        return;
      }
      if (cloud) await this.installCloud(cloud);
      else { this.cloud = undefined; this.ready = true; }
    });
  }
  private async installCloud(cloud: ProjectWorldDocument): Promise<void> {
    const uid = this.auth.user?.uid;
    const projectId = this.projectId;
    const files = await this.worlds.resources(cloud, text => this.progress = text);
    if (this.destroyed || uid !== this.auth.user?.uid || projectId !== this.projectId) return;
    readWorldedWorld(cloud.xml);
    this.cloud = cloud;
    this.document = new DOMParser().parseFromString(cloud.xml, 'application/xml');
    this.cell = undefined;
    this.files = files;
    this.dirty = false;
    this.ready = true;
    this.syncMessage = '';
    // Reveal the viewer before it measures its canvas, including in browsers
    // without ResizeObserver.
    this.changeDetector.detectChanges();
    await this.preview();
  }
  private xml(): string {
    if (!this.document) throw new Error('Open a hosted world first.');
    return new XMLSerializer().serializeToString(this.document);
  }
  async preview(): Promise<void> {
    const xml = this.xml();
    const world = readWorldedWorld(xml);
    const position = this.viewer.workspace?.selectedCell;
    await this.viewer.openHosted({
      world, worldFile: new File([xml], this.cloud!.name), files: this.files,
      folderName: this.projectName, warnings: [], omittedResources: 0, restored: false,
      selectedCell: position,
    });
  }
  refreshPreview(): void { void this.run(() => this.preview()); }
  selectCell(): void {
    if (!this.isAdmin) return;
    const position = this.viewer.workspace?.selectedCell;
    if (!position || !this.document) { this.error = 'Select a cell on the world map first.'; return; }
    this.cell = Array.from(this.document.documentElement.children).find(element => element.tagName === 'cell' &&
      Number(this.attr(element, 'x')) === position.x && Number(this.attr(element, 'y')) === position.y);
    if (!this.cell) {
      this.cell = this.document.createElement('cell');
      this.cell.setAttribute('x', String(position.x));
      this.cell.setAttribute('y', String(position.y));
      this.document.documentElement.appendChild(this.cell);
    }
    this.error = '';
  }
  set(element: Element, attribute: string, event: Event): void {
    if (!this.isAdmin) return;
    element.setAttribute(attribute, (event.target as HTMLInputElement).value);
    this.dirty = true;
  }
  add(kind: 'lot' | 'object'): void {
    if (!this.isAdmin) return;
    if (!this.cell || !this.document) return;
    const element = this.document.createElement(kind);
    const attributes = kind === 'lot'
      ? { x: '0', y: '0', width: '10', height: '10', level: '0', map: this.lotPaths[0] ?? '' }
      : { x: '0', y: '0', width: '10', height: '10', level: '0', name: 'New zone', type: '', group: '' };
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    this.cell.appendChild(element);
    this.dirty = true;
  }
  remove(element: Element): void { if (this.isAdmin) { element.remove(); this.dirty = true; } }
  save(): Promise<void> {
    if (!this.isAdmin) return Promise.resolve();
    return this.run(async () => {
      const xml = this.xml();
      const result = await this.worlds.save(this.projectId, xml, this.cloud!.revision);
      this.cloud = { ...result, xml };
      this.dirty = false;
      this.syncMessage = '';
      await this.preview();
      this.message = `World saved to project. Revision ${result.revision}.`;
    });
  }
  async chooseWorld(event: Event): Promise<void> {
    if (!this.isAdmin) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.run(async () => {
      if (!/\.pzw$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw new Error('Choose a PZW file of at most 8 MiB.');
      readWorldedWorld(await file.text());
      this.pending = { worldFile: file, files: new Map(), folderName: '', warnings: [], omittedResources: 0 };
    });
  }
  async chooseFolder(event: Event): Promise<void> {
    if (!this.isAdmin) return;
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    input.value = '';
    if (!this.pending || !selected.length) return;
    await this.run(async () => {
      const pending = this.pending!;
      const world = readWorldedWorld(await pending.worldFile.text());
      const resolved = await resolveWorldedProject(selected, pending.worldFile, world);
      if (resolved.warnings.length) throw new Error(`Cannot upload an incomplete world. ${resolved.warnings.join(' ')}`);
      this.pending = { ...pending, ...resolved };
    });
  }
  upload(): void {
    if (!this.pending || !this.isAdmin) return;
    if (this.dirty && !window.confirm('Replace the cloud world and discard your unsaved edits?')) return;
    void this.run(async () => {
      const pending = this.pending!;
      const result = await this.worlds.upload(this.projectId, pending, this.cloud?.revision ?? 0, text => this.progress = text);
      const xml = await pending.worldFile.text();
      this.cloud = { ...result, xml };
      this.document = new DOMParser().parseFromString(xml, 'application/xml');
      this.files = await this.worlds.resources(this.cloud, text => this.progress = text);
      this.cell = undefined;
      this.pending = undefined;
      this.dirty = false;
      this.syncMessage = '';
      await this.preview();
      this.message = 'World uploaded. Invited contributors can view it here.';
    });
  }
}
