import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import * as fromRoot from '../../app.reducers';
import { ClearBuilding, SetCurrentTool, SetDocumentLocked } from '../../app.actions';
import { BuildingService } from '../../services/building.service';
import { EditorSessionService } from '../../services/editor-session.service';
import { ProjectApiService } from '../../services/project-api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  styleUrls: ['../../app.component.scss', './editor.component.scss']
})
export class EditorComponent implements OnInit, OnDestroy {
  readonly selectedTool$ = this.store.select(fromRoot.getCurrentTool);
  ready = false;
  error = '';
  private variantId?: string;
  private buildingPath?: string;
  private destroyed = false;
  private authSubscription?: Subscription;
  private routeSubscription?: Subscription;
  private loadGeneration = 0;

  constructor(private route: ActivatedRoute, private router: Router, private store: Store<fromRoot.State>,
    private buildings: BuildingService, public session: EditorSessionService,
    private api: ProjectApiService, public auth: AuthService) { }

  ngOnInit(): void {
    this.variantId = this.route.snapshot.paramMap.get('variantId') || undefined;
    this.buildingPath = this.route.snapshot.paramMap.get('buildingPath') || undefined;
    if (this.variantId || this.buildingPath) {
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
        if (user?.uid !== uid || (this.buildingPath && !this.auth.isAdmin)) {
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
    if (!this.variantId && !this.buildingPath) return;
    this.ready = false;
    this.error = '';
    const uid = this.auth.user?.uid;
    const generation = ++this.loadGeneration;
    try {
      const projectId = this.route.snapshot.paramMap.get('projectId')!;
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
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent): void {
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
    if (this.variantId || this.buildingPath) {
      this.session.cacheCurrent();
      this.session.end();
      this.store.dispatch(new ClearBuilding());
    }
  }
}
