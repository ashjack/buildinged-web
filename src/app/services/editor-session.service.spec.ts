import { TestBed } from '@angular/core/testing';
import { Store, StoreModule } from '@ngrx/store';
import { reducer, State, getBuilding, getRootState } from '../app.reducers';
import { AddTile, ClearBuilding, SetBuilding, SetDocumentLocked, Undo } from '../app.actions';
import { AuthService } from './auth.service';
import { ProjectApiService } from './project-api.service';
import { EditorSessionService } from './editor-session.service';
import { BuildingService } from './building.service';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { Contribution, VariantDocument } from '../models/project.models';
import { Building } from '../models/app.models';

const item: Contribution = {
  id: 'variant', projectId: 'project', taskId: 'task', originalBuildId: 'original', sourceRevisionId: 'source',
  createdBy: 'user', name: 'Furnished option', status: 'draft', revision: 1, deliverableUrl: '', reviewNote: ''
};

describe('Project editor session', () => {
  let session: EditorSessionService;
  let store: Store<State>;
  let api: jasmine.SpyObj<ProjectApiService>;
  const canonical = () => new XMLSerializer().serializeToString(writeBuildingFile(
    readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'))));
  const snapshot = (): Building => {
    let value: Building | undefined;
    store.select(getBuilding).subscribe(building => value = building).unsubscribe();
    return value!;
  };
  const open = (document: VariantDocument = { contribution: item, xml: nativeBuildingXml }): void => {
    const xml = session.begin(document);
    store.dispatch(new SetBuilding(readBuildingFile(new DOMParser().parseFromString(xml, 'text/xml'))));
  };
  beforeEach(() => {
    localStorage.removeItem('buildinged:draft:user:project:variant');
    api = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['save', 'submit', 'saveWorldBuilding', 'createWorldBuilding']);
    TestBed.configureTestingModule({
      imports: [StoreModule.forRoot({}), StoreModule.forFeature('root', reducer)],
      providers: [
        { provide: AuthService, useValue: { user: { uid: 'user' }, isAdmin: true, apiBaseUrl: 'http://localhost/api' } },
        { provide: ProjectApiService, useValue: api }
      ]
    });
    store = TestBed.inject(Store);
    session = TestBed.inject(EditorSessionService);
  });
  afterEach(() => {
    localStorage.removeItem('buildinged:draft:user:project:variant');
    localStorage.removeItem('buildinged:world-building:http%3A%2F%2Flocalhost%2Fapi:user:project:Buildings/house.tbx');
    localStorage.removeItem('buildinged:new-world-building:http%3A%2F%2Flocalhost%2Fapi:user:project:Buildings/house.tbx');
  });

  const worldBuilding = { projectId: 'project', path: 'Buildings/house.tbx', revision: 5, xml: nativeBuildingXml };
  const openWorldBuilding = (): void => {
    const xml = session.beginWorldBuilding(worldBuilding);
    store.dispatch(new SetBuilding(readBuildingFile(new DOMParser().parseFromString(xml, 'text/xml'))));
  };

  it('records the entered submitter name for signed-in variants too', async () => {
    open(); api.save.and.resolveTo({ ...item, revision: 2 });
    api.submit.and.resolveTo({ ...item, revision: 3, status: 'submitted', submitterName: 'Morgan' });
    await session.submit('Morgan');
    expect(api.submit).toHaveBeenCalledOnceWith(item.id, 2, '', 'Morgan');
    expect(session.contribution!.submitterName).toBe('Morgan');
  });

  it('keeps a new building local until publishing, then uses ordinary world saves', async () => {
    const xml = session.beginWorldBuilding(worldBuilding, true, true);
    store.dispatch(new SetBuilding(readBuildingFile(new DOMParser().parseFromString(xml, 'text/xml'))));
    expect(session.dirty).toBeTrue();
    expect(session.newWorldBuilding).toBeTrue();
    const draftKey = session.cacheTarget.key;
    session.saveLocalDraft();
    expect(session.message).toContain('Draft saved in this browser');
    expect(api.createWorldBuilding).not.toHaveBeenCalled();
    expect(draftKey).toContain('new-world-building');
    const created = jasmine.createSpy('created');
    session.buildingCreated$.subscribe(created);
    api.createWorldBuilding.and.resolveTo({ projectId: 'project', path: worldBuilding.path, revision: 8 });
    expect(await session.save()).toBeTrue();
    expect(api.createWorldBuilding).toHaveBeenCalledOnceWith('project', worldBuilding.path, session.serialize());
    expect(session.newWorldBuilding).toBeFalse();
    expect(session.dirty).toBeFalse();
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(created).toHaveBeenCalledOnceWith(session.worldBuilding);
    api.saveWorldBuilding.and.resolveTo({ projectId: 'project', path: worldBuilding.path, revision: 9 });
    expect(await session.save()).toBeTrue();
    expect(api.saveWorldBuilding).toHaveBeenCalledOnceWith('project', worldBuilding.path, session.serialize(), 8);
    expect(api.save).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('recovers an unpublished building and preserves it when publishing fails', async () => {
    let xml = session.beginWorldBuilding(worldBuilding, true, true);
    store.dispatch(new SetBuilding(readBuildingFile(new DOMParser().parseFromString(xml, 'text/xml'))));
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    const draft = session.serialize();
    session.cacheCurrent();
    session.end();
    xml = session.beginWorldBuilding({ ...worldBuilding, revision: 7 }, true, true);
    expect(xml).toBe(draft);
    store.dispatch(new SetBuilding(readBuildingFile(new DOMParser().parseFromString(xml, 'text/xml'))));
    api.createWorldBuilding.and.rejectWith(new Error('A building already uses this path.'));
    expect(await session.save()).toBeFalse();
    expect(session.newWorldBuilding).toBeTrue();
    expect(session.dirty).toBeTrue();
    expect(session.serialize()).toBe(draft);
    expect(localStorage.getItem(session.cacheTarget.key)).not.toBeNull();
  });

  it('saves an admin edit to the shared world without creating or submitting a variant', async () => {
    openWorldBuilding();
    expect(session.contribution).toBeUndefined();
    expect(session.dirty).toBeFalse();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    expect(session.dirty).toBeTrue();
    const xml = session.serialize();
    api.saveWorldBuilding.and.resolveTo({ projectId: 'project', path: worldBuilding.path, revision: 6 });
    expect(await session.save()).toBeTrue();
    expect(api.saveWorldBuilding).toHaveBeenCalledOnceWith('project', worldBuilding.path, xml, 5);
    expect(api.save).not.toHaveBeenCalled();
    expect(session.dirty).toBeFalse();
    expect(session.worldBuilding!.revision).toBe(6);
    expect(JSON.parse(localStorage.getItem(session.cacheTarget.key)!).revision).toBe(6);
    await session.submit();
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('preserves failed admin edits and recovers their old revision without overwriting cloud work', async () => {
    openWorldBuilding();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    session.cacheCurrent();
    const localXml = session.serialize();
    api.saveWorldBuilding.and.rejectWith(new Error('The world changed in another session.'));
    expect(await session.save()).toBeFalse();
    expect(session.dirty).toBeTrue();
    const recovered = session.beginWorldBuilding({ ...worldBuilding, revision: 6 });
    expect(recovered).toBe(localXml);
    expect(session.worldBuilding!.revision).toBe(5);
    expect(session.message).toContain('older cloud revision');
    expect(session.cacheTarget.key).not.toBe('buildingXml');
  });

  it('requires an admin account to edit shared buildings and prompts before losing unsaved edits', async () => {
    openWorldBuilding();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    spyOn(window, 'confirm').and.returnValue(false);
    expect(session.canLeave()).toBeFalse();
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    expect(session.editable).toBeFalse();
    expect(await session.save()).toBeFalse();
    expect(api.saveWorldBuilding).not.toHaveBeenCalled();
    session.end();
    expect(session.worldBuilding).toBeUndefined();
  });

  it('normalizes a cloud TBX without marking an unchanged document dirty', () => {
    open();
    expect(session.savedXml).toBe(canonical());
    expect(session.dirty).toBeFalse();
    expect(session.cacheTarget.key).toBe('buildinged:draft:user:project:variant');
  });

  it('saves to the variant, never the source, and scopes recovery by user/project/variant', async () => {
    open();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    const xml = session.serialize();
    api.save.and.resolveTo({ ...item, revision: 2 });
    expect(await session.save()).toBeTrue();
    expect(api.save).toHaveBeenCalledOnceWith('variant', xml, 1);
    expect(session.dirty).toBeFalse();
    expect(JSON.parse(localStorage.getItem(session.cacheTarget.key)!).revision).toBe(2);
    expect(session.savedXml).toBe(xml);
  });

  it('locks document edits and undo while saving and unlocks after success', async () => {
    open();
    let finish!: (value: Contribution) => void;
    api.save.and.returnValue(new Promise(resolve => finish = resolve));
    const before = snapshot();
    const saving = session.save();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    store.dispatch(new Undo());
    expect(snapshot()).toBe(before);
    finish({ ...item, revision: 2 });
    await saving;
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    expect(snapshot()).not.toBe(before);
  });

  it('retains a dirty local draft and does not submit when cloud saving fails', async () => {
    open();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    session.cacheCurrent();
    api.save.and.rejectWith(new Error('Revision conflict'));
    await session.submit();
    expect(session.error).toBe('Revision conflict');
    expect(session.dirty).toBeTrue();
    expect(api.submit).not.toHaveBeenCalled();
    expect(localStorage.getItem(session.cacheTarget.key)).not.toBeNull();
  });

  it('submits a successfully saved revision and locks the reviewed document', async () => {
    open();
    api.save.and.resolveTo({ ...item, revision: 2 });
    api.submit.and.resolveTo({ ...item, revision: 3, status: 'submitted' });
    await session.submit();
    expect(api.submit).toHaveBeenCalledOnceWith('variant', 2);
    expect(session.editable).toBeFalse();
    const before = snapshot();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    expect(snapshot()).toBe(before);
  });

  it('recovers stale drafts with their original base revision so they cannot silently overwrite cloud work', () => {
    open();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    const localXml = session.serialize();
    session.cacheCurrent();
    const recovered = session.begin({ contribution: { ...item, revision: 2 }, xml: nativeBuildingXml });
    expect(recovered).toBe(localXml);
    expect(session.contribution!.revision).toBe(1);
    expect(session.message).toContain('older cloud revision');
  });

  it('a delayed cache from an earlier revision or another session cannot replace newer recovery data', () => {
    open();
    const buildings = new BuildingService(null!, null!, null!, null!, store, null!, session);
    const target = buildings.cacheTarget;
    const before = snapshot();
    session.contribution = { ...item, revision: 2 };
    session.cacheCurrent();
    const current = localStorage.getItem(session.cacheTarget.key);
    buildings.cacheBuilding(before, target);
    expect(localStorage.getItem(session.cacheTarget.key)).toBe(current);
    session.end();
    buildings.cacheBuilding(before, { ...target, revision: 2 });
    expect(localStorage.getItem(target.key)).toBe(current);
  });

  it('clearing a project document removes document, history, and editing locks', () => {
    open();
    store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_01_001.png'));
    store.dispatch(new SetDocumentLocked(true));
    store.dispatch(new ClearBuilding());
    let state!: State;
    store.select(getRootState).subscribe(value => state = value).unsubscribe();
    expect(state.building).toBeUndefined();
    expect(state.past).toEqual([]);
    expect(state.documentLocked).toBeFalse();
  });

  it('a save finishing after session invalidation cannot restore private project state', async () => {
    open();
    let finish!: (value: Contribution) => void;
    api.save.and.returnValue(new Promise(resolve => finish = resolve));
    const saving = session.save();
    session.end();
    store.dispatch(new ClearBuilding());
    finish({ ...item, revision: 2 });
    expect(await saving).toBeFalse();
    expect(session.contribution).toBeUndefined();
    expect(session.busy).toBeFalse();
  });
});
