import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  let route: { snapshot: { paramMap: ReturnType<typeof convertToParamMap>; queryParamMap?: ReturnType<typeof convertToParamMap>; data?: Record<string, boolean> }; paramMap: typeof params };
  let user: BehaviorSubject<{ uid: string } | null>;
  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({ projectId: 'project', variantId: 'a' }));
    route = { snapshot: { paramMap: params.value }, paramMap: params };
    user = new BehaviorSubject<{ uid: string } | null>({ uid: 'user' });
    api = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['variant', 'worldBuilding', 'request', 'createWorldBuilding']);
    api.variant.and.resolveTo({ contribution, xml: nativeBuildingXml });
    buildings = jasmine.createSpyObj<BuildingService>('BuildingService', ['createBuildingFromXml', 'getTemplateNames', 'newBuilding']);
    buildings.getTemplateNames.and.resolveTo(['Residential']);
    buildings.newBuilding.and.resolveTo(readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')));
    TestBed.configureTestingModule({
      declarations: [EditorComponent], schemas: [NO_ERRORS_SCHEMA],
      imports: [CommonModule, FormsModule, RouterTestingModule, StoreModule.forRoot({}), StoreModule.forFeature('root', reducer)],
      providers: [
        { provide: AuthService, useValue: { get user() { return user.value; }, user$: user.asObservable(), isAdmin: true, apiBaseUrl: 'http://localhost/api' } },
        { provide: ProjectApiService, useValue: api }, { provide: BuildingService, useValue: buildings },
        { provide: ActivatedRoute, useValue: route }
      ]
    });
    store = TestBed.inject(Store);
    buildings.createBuildingFromXml.and.callFake(async document => {
      store.dispatch(new SetBuilding(readBuildingFile(document)));
    });
  });

  afterEach(() => {
    localStorage.removeItem('buildinged:new-world-building:http%3A%2F%2Flocalhost%2Fapi:user:project:Buildings/new-house.tbx');
    localStorage.removeItem('buildinged:world-building:http%3A%2F%2Flocalhost%2Fapi:user:project:Buildings/new-house.tbx');
  });

  it('offers building dimensions and a template before opening a local project draft', async () => {
    route.snapshot.data = { newWorldBuilding: true };
    route.snapshot.paramMap = convertToParamMap({ projectId: 'project' });
    params.next(route.snapshot.paramMap);
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('New project building');
    const component = fixture.componentInstance;
    component.buildingName = 'new-house'; component.width = 32; component.height = 24; component.templateName = 'Residential';
    await component.startNewBuilding();
    expect(navigate).toHaveBeenCalledOnceWith(['/projects', 'project', 'world-buildings', 'Buildings/new-house.tbx', 'edit'], {
      queryParams: { create: 'true', width: 32, height: 24, template: 'Residential' }
    });
    expect(api.createWorldBuilding).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('edits a new building locally and clears the creation URL only after publishing', async () => {
    route.snapshot.paramMap = convertToParamMap({ projectId: 'project', buildingPath: 'Buildings/new-house.tbx' });
    route.snapshot.queryParamMap = convertToParamMap({ create: 'true', width: '32', height: '24', template: 'Residential' });
    params.next(route.snapshot.paramMap);
    api.request.and.resolveTo({ projectId: 'project', revision: 4, files: [] });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const session = TestBed.inject(EditorSessionService);
    expect(buildings.newBuilding).toHaveBeenCalledOnceWith('Residential', { width: 32, height: 24 });
    expect(session.newWorldBuilding).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Add building to world');
    expect(api.worldBuilding).not.toHaveBeenCalled();
    expect(api.createWorldBuilding).not.toHaveBeenCalled();
    api.createWorldBuilding.and.resolveTo({ projectId: 'project', path: 'Buildings/new-house.tbx', revision: 5 });
    expect(await session.save()).toBeTrue();
    expect(navigate).toHaveBeenCalledOnceWith(['/projects', 'project', 'world-buildings', 'Buildings/new-house.tbx', 'edit'], { replaceUrl: true });
    fixture.destroy();
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

  it('opens a shared building in admin mode with a direct save and no submission controls', async () => {
    const next = convertToParamMap({ projectId: 'project', buildingPath: 'Buildings/house.tbx' });
    route.snapshot.paramMap = next;
    params.next(next);
    api.worldBuilding.and.resolveTo({ projectId: 'project', path: 'Buildings/house.tbx', revision: 3, xml: nativeBuildingXml });
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(api.worldBuilding).toHaveBeenCalledOnceWith('project', 'Buildings/house.tbx');
    expect(api.variant).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Save building to world');
    expect(fixture.nativeElement.textContent).not.toContain('Submit for review');
    expect(TestBed.inject(EditorSessionService).worldBuilding!.path).toBe('Buildings/house.tbx');
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
