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
  private destroyed = false;
  private authSubscription?: Subscription;
  private routeSubscription?: Subscription;
  private loadGeneration = 0;

  constructor(private route: ActivatedRoute, private router: Router, private store: Store<fromRoot.State>,
    private buildings: BuildingService, public session: EditorSessionService,
    private api: ProjectApiService, public auth: AuthService) { }

  ngOnInit(): void {
    this.variantId = this.route.snapshot.paramMap.get('variantId') || undefined;
    if (this.variantId) {
      this.routeSubscription = this.route.paramMap.subscribe(params => {
        const id = params.get('variantId')!;
        this.session.cacheCurrent();
        this.session.end();
        this.store.dispatch(new ClearBuilding());
        this.variantId = id;
        void this.load();
      });
      const uid = this.auth.user?.uid;
      this.authSubscription = this.auth.user$.subscribe(user => {
        if (user?.uid !== uid) {
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
    if (!this.variantId) return;
    this.ready = false;
    this.error = '';
    const uid = this.auth.user?.uid;
    const generation = ++this.loadGeneration;
    try {
      const document = await this.api.variant(this.variantId);
      if (this.destroyed || this.auth.user?.uid !== uid || generation !== this.loadGeneration) return;
      if (document.contribution.projectId !== this.route.snapshot.paramMap.get('projectId')) {
        throw new Error('This variant does not belong to the project in this URL.');
      }
      const xml = this.session.begin(document, recover);
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
    if (this.variantId) {
      this.session.cacheCurrent();
      this.session.end();
      this.store.dispatch(new ClearBuilding());
    }
  }
}
