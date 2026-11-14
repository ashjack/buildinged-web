import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import * as fromRoot from '../../app.reducers';
import { ClearBuilding, SetCurrentTool, SetDocumentLocked } from '../../app.actions';
import { BuildingService } from '../../services/building.service';
import { EditorSessionService } from '../../services/editor-session.service';
import { ProjectApiService } from '../../services/project-api.service';
import { AuthService } from '../../services/auth.service';
import { ProjectWorldDocument } from '../../services/project-world.service';
import { writeBuildingFile } from '../../utils/tbx-format';
import { worldBuildingCopyPath } from '../../utils/world-building-copy';
import { GuestVariantsService } from '../../services/guest-variants.service';

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  styleUrls: ['../../app.component.scss', './editor.component.scss']
})
export class EditorComponent implements OnInit, OnDestroy {
  @ViewChild('submitDialog') submitDialog?: ElementRef<HTMLDialogElement>;
  readonly selectedTool$ = this.store.select(fromRoot.getCurrentTool);
  ready = false;
  error = '';
  newBuildingSetup = false;
  setupBusy = false;
  buildingName = '';
  width = 24;
  height = 20;
  templateNames: string[] = [];
  templateName = '';
  get copyFrom(): string { return this.route.snapshot.queryParamMap?.get('copyFrom') || ''; }
  get projectId(): string { return this.route.snapshot.paramMap.get('projectId')!; }
  get validSetup(): boolean {
    return !!this.buildingName.trim() && Number.isInteger(this.width) && Number.isInteger(this.height) &&
      this.width >= 1 && this.width <= 256 && this.height >= 1 && this.height <= 256;
  }
  private variantId?: string;
  private buildingPath?: string;
  private destroyed = false;
  private authSubscription?: Subscription;
  private routeSubscription?: Subscription;
  private creationSubscription?: Subscription;
  private loadGeneration = 0;

  constructor(private route: ActivatedRoute, private router: Router, private store: Store<fromRoot.State>,
    private buildings: BuildingService, public session: EditorSessionService,
    private api: ProjectApiService, public auth: AuthService, private guests: GuestVariantsService) { }

  ngOnInit(): void {
    this.variantId = this.route.snapshot.paramMap.get('variantId') || undefined;
    this.buildingPath = this.route.snapshot.paramMap.get('buildingPath') || undefined;
    this.newBuildingSetup = !!this.route.snapshot.data?.['newWorldBuilding'];
    this.creationSubscription = this.session.buildingCreated$.subscribe(item => {
      void this.router.navigate(['/projects', item.projectId, 'world-buildings', item.path, 'edit'], { replaceUrl: true });
    });
    if (this.variantId || this.buildingPath || this.newBuildingSetup) {
      this.routeSubscription = this.route.paramMap.subscribe(params => {
        this.session.cacheCurrent();
        this.session.end();
        this.store.dispatch(new ClearBuilding());
        this.variantId = params.get('variantId') || undefined;
        this.buildingPath = params.get('buildingPath') || undefined;
        void this.load();
      });
      const uid = this.auth.user?.uid;
      this.authSubscription = this.auth.user$.subscribe(user => {
        if (!this.session.guest && (user?.uid !== uid || ((this.buildingPath || this.newBuildingSetup) && !this.auth.isAdmin))) {
          this.loadGeneration++;
          this.ready = false;
          this.session.end();
          this.store.dispatch(new ClearBuilding());
          void this.router.navigate(['/']);
        }
      });
    } else {
      this.session.end();
      this.ready = true;
    }
  }

  async load(recover = true): Promise<void> {
    if (this.newBuildingSetup) {
      this.error = '';
      const generation = ++this.loadGeneration;
      const uid = this.auth.user?.uid;
      if (this.copyFrom) {
        this.setupBusy = true;
        try {
          const projectId = this.projectId, source = this.copyFrom;
          const [document, world] = await Promise.all([
            this.api.worldBuilding(projectId, source),
            this.api.request<ProjectWorldDocument | null>('GET', `/projects/${encodeURIComponent(projectId)}/world`),
          ]);
          if (this.destroyed || this.auth.user?.uid !== uid || generation !== this.loadGeneration) return;
          if (!world || document.projectId !== projectId || document.path !== source) throw new Error('Could not load the source building from this project.');
          this.buildingName = worldBuildingCopyPath(source, world.files.map(file => file.path));
        } catch (error) {
          if (!this.destroyed && generation === this.loadGeneration) this.error = error instanceof Error ? error.message : String(error);
        } finally { if (generation === this.loadGeneration) this.setupBusy = false; }
        return;
      }
      try {
        this.templateNames = await this.buildings.getTemplateNames();
        this.templateName = this.templateNames[0] || '';
      }
      catch { this.error = 'Could not load starter templates. You can still start with an empty building.'; }
      return;
    }
    if (!this.variantId && !this.buildingPath) return;
    this.ready = false;
    this.error = '';
    const uid = this.auth.user?.uid;
    const generation = ++this.loadGeneration;
    try {
      const projectId = this.route.snapshot.paramMap.get('projectId')!;
      if (this.variantId?.startsWith('guest-')) {
        const draft = this.guests.read(this.variantId);
        if (draft.contribution.projectId !== projectId) throw new Error('This local variant belongs to another project.');
        const xml = this.session.beginGuest(draft);
        await this.buildings.createBuildingFromXml(new DOMParser().parseFromString(xml, 'text/xml'));
        this.store.dispatch(new SetDocumentLocked(!this.session.editable));
        this.store.dispatch(new SetCurrentTool('tool-furniture')); this.ready = true; return;
      }
      if (this.buildingPath && this.route.snapshot.queryParamMap?.get('create') === 'true') {
        const world = await this.api.request<ProjectWorldDocument | null>('GET', `/projects/${encodeURIComponent(projectId)}/world`);
        if (this.destroyed || this.auth.user?.uid !== uid || generation !== this.loadGeneration) return;
        if (!world) throw new Error('Upload a shared world for this project before creating a world building.');
        if (world.files.some(file => file.path.toLowerCase() === this.buildingPath!.toLowerCase())) {
          throw new Error('A building already uses this path. Return to the building list and choose another name.');
        }
        let sourceXml: string;
        if (this.copyFrom) {
          const source = await this.api.worldBuilding(projectId, this.copyFrom);
          if (source.projectId !== projectId || source.path !== this.copyFrom) throw new Error('This source building does not belong to this project.');
          sourceXml = source.xml;
        } else {
          const width = Number(this.route.snapshot.queryParamMap.get('width'));
          const height = Number(this.route.snapshot.queryParamMap.get('height'));
          const building = await this.buildings.newBuilding(this.route.snapshot.queryParamMap.get('template') || undefined, { width, height });
          sourceXml = new XMLSerializer().serializeToString(writeBuildingFile(building));
        }
        if (this.destroyed || this.auth.user?.uid !== uid || generation !== this.loadGeneration) return;
        const xml = this.session.beginWorldBuilding({ projectId, path: this.buildingPath, revision: world.revision,
          xml: sourceXml }, recover, true);
        await this.buildings.createBuildingFromXml(new DOMParser().parseFromString(xml, 'text/xml'));
        this.store.dispatch(new SetDocumentLocked(!this.session.editable));
        this.store.dispatch(new SetCurrentTool('tool-draw-room'));
        this.ready = true;
        return;
      }
      const document = this.buildingPath
        ? await this.api.worldBuilding(projectId, this.buildingPath)
        : await this.api.variant(this.variantId!);
      if (this.destroyed || this.auth.user?.uid !== uid || generation !== this.loadGeneration) return;
      if (('contribution' in document ? document.contribution.projectId : document.projectId) !== projectId) {
        throw new Error('This building does not belong to the project in this URL.');
      }
      const xml = 'contribution' in document ? this.session.begin(document, recover) : this.session.beginWorldBuilding(document, recover);
      await this.buildings.createBuildingFromXml(new DOMParser().parseFromString(xml, 'text/xml'));
      this.store.dispatch(new SetDocumentLocked(!this.session.editable));
      this.store.dispatch(new SetCurrentTool('tool-furniture'));
      this.ready = true;
    } catch (error) {
      if (generation === this.loadGeneration && !this.destroyed) this.error = error instanceof Error ? error.message : String(error);
    }
  }
  async startNewBuilding(): Promise<void> {
    if (!this.validSetup || this.setupBusy || !this.auth.isAdmin) return;
    let path = this.buildingName.trim();
    if (!/\.tbx$/i.test(path)) path += '.tbx';
    if (!path.includes('/')) path = `Buildings/${path}`;
    if (path.length > 1000 || /[\x00-\x1f\\:]/.test(path) || path.startsWith('/') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
      this.error = 'Enter a building name or relative project path, such as Buildings/house.tbx.';
      return;
    }
    this.setupBusy = true;
    this.error = '';
    try {
      await this.router.navigate(['/projects', this.projectId, 'world-buildings', path, 'edit'], {
        queryParams: this.copyFrom ? { create: 'true', copyFrom: this.copyFrom }
          : { create: 'true', width: this.width, height: this.height, template: this.templateName || null }
      });
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { this.setupBusy = false; }
  }
  reload(): void {
    if (this.session.busy) return;
    if (!this.session.dirty || window.confirm('Replace the local draft with the latest cloud copy? Export first if you want to keep your edits.')) {
      void this.load(false);
    }
  }
  async exportBuilding(): Promise<void> {
    try { await this.buildings.saveBuildingToXml(); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }
  canLeave(): boolean {
    return this.session.canLeave();
  }
  openSubmit(): void {
    if (!this.session.editable || this.session.busy) return;
    this.submitDialog?.nativeElement.showModal();
    this.submitDialog?.nativeElement.querySelector('input')?.focus();
  }
  async submitVariant(): Promise<void> {
    if (!this.session.submitterName.trim() || this.session.submitterName.trim().length > 120) return;
    await this.session.submit(this.session.submitterName.trim());
    if (this.session.contribution?.status === 'submitted') this.submitDialog?.nativeElement.close();
  }
  @HostListener('window:pagehide') keepLocalDraft(): void { this.session.cacheCurrent(); }
  @HostListener('document:visibilitychange') cacheHiddenDraft(): void { if (document.visibilityState === 'hidden') this.session.cacheCurrent(); }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
    if (this.session.guest && !this.session.busy) {
      this.session.error = ''; this.session.cacheCurrent();
      if (!this.session.error) return;
      event.preventDefault(); event.returnValue = ''; return;
    }
    if (this.session.dirty || this.session.busy) {
      this.session.cacheCurrent();
      event.preventDefault();
      event.returnValue = '';
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.authSubscription?.unsubscribe();
    this.routeSubscription?.unsubscribe();
    this.creationSubscription?.unsubscribe();
    if (this.variantId || this.buildingPath || this.newBuildingSetup) {
      this.session.cacheCurrent();
      this.session.end();
      this.store.dispatch(new ClearBuilding());
    }
  }
}
