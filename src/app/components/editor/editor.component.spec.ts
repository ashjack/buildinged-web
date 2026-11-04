import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Store, StoreModule } from '@ngrx/store';
import { BehaviorSubject } from 'rxjs';
import { ClearBuilding, SetBuilding } from '../../app.actions';
import { getBuilding, reducer, State } from '../../app.reducers';
import { Contribution, VariantDocument } from '../../models/project.models';
import { AuthService } from '../../services/auth.service';
import { BuildingService } from '../../services/building.service';
import { EditorSessionService } from '../../services/editor-session.service';
import { ProjectApiService } from '../../services/project-api.service';
import { nativeBuildingXml } from '../../testing/native-building.fixture';
import { readBuildingFile } from '../../utils/tbx-format';
import { EditorComponent } from './editor.component';

const contribution: Contribution = { id: 'a', projectId: 'project', taskId: 'task', originalBuildId: 'original',
  sourceRevisionId: 'source', createdBy: 'user', name: 'Option A', status: 'draft', revision: 1, deliverableUrl: '', reviewNote: '' };

describe('Routed variant editor', () => {
  let store: Store<State>;
  let api: jasmine.SpyObj<ProjectApiService>;
  let buildings: jasmine.SpyObj<BuildingService>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let route: { snapshot: { paramMap: ReturnType<typeof convertToParamMap> }; paramMap: typeof params };
  let user: BehaviorSubject<{ uid: string } | null>;
  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({ projectId: 'project', variantId: 'a' }));
    route = { snapshot: { paramMap: params.value }, paramMap: params };
    user = new BehaviorSubject<{ uid: string } | null>({ uid: 'user' });
    api = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['variant']);
    api.variant.and.resolveTo({ contribution, xml: nativeBuildingXml });
    buildings = jasmine.createSpyObj<BuildingService>('BuildingService', ['createBuildingFromXml']);
    TestBed.configureTestingModule({
      declarations: [EditorComponent], schemas: [NO_ERRORS_SCHEMA],
      imports: [CommonModule, RouterTestingModule, StoreModule.forRoot({}), StoreModule.forFeature('root', reducer)],
      providers: [
        { provide: AuthService, useValue: { get user() { return user.value; }, user$: user.asObservable() } },
        { provide: ProjectApiService, useValue: api }, { provide: BuildingService, useValue: buildings },
        { provide: ActivatedRoute, useValue: route }
      ]
    });
    store = TestBed.inject(Store);
    buildings.createBuildingFromXml.and.callFake(async document => {
      store.dispatch(new SetBuilding(readBuildingFile(document)));
    });
  });

  it('loads the server-created variant and starts in furnishing mode', async () => {
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(api.variant).toHaveBeenCalledWith('a');
    expect(buildings.createBuildingFromXml).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.ready).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Save draft');
    expect(TestBed.inject(EditorSessionService).contribution!.originalBuildId).toBe('original');
    fixture.destroy();
  });

  it('a reused route loads its new variant and ignores an earlier in-flight response', async () => {
    let finishA!: (document: VariantDocument) => void;
    api.variant.and.callFake(id => id === 'a' ? new Promise(resolve => finishA = resolve)
      : Promise.resolve({ contribution: { ...contribution, id: 'b', name: 'Option B' }, xml: nativeBuildingXml }));
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.detectChanges();
    const next = convertToParamMap({ projectId: 'project', variantId: 'b' });
    route.snapshot.paramMap = next;
    params.next(next);
    await fixture.whenStable();
    finishA({ contribution, xml: nativeBuildingXml });
    await Promise.resolve();
    expect(TestBed.inject(EditorSessionService).contribution!.id).toBe('b');
    expect(buildings.createBuildingFromXml).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('invalidating Google authentication clears the project document', async () => {
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.detectChanges(); await fixture.whenStable();
    user.next(null);
    expect(fixture.componentInstance.ready).toBeFalse();
    let empty = false;
    store.select(getBuilding).subscribe(building => empty = !building).unsubscribe();
    expect(empty).toBeTrue();
    expect(navigate).toHaveBeenCalledWith(['/']);
    fixture.destroy();
    store.dispatch(new ClearBuilding());
  });
});
