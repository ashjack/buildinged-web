import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { ProjectApiService } from './project-api.service';
import { GuestVariantsService } from './guest-variants.service';
import { ProjectTask } from '../models/project.models';
import { THAMES_VALLEY_PROJECT_ID } from '../utils/default-project';
import { nativeBuildingXml } from '../testing/native-building.fixture';

const task: ProjectTask = { id: 'task', projectId: THAMES_VALLEY_PROJECT_ID, title: 'Furnish house', type: 'furnish', description: '',
  requirements: '', priority: 'normal', status: 'available', sourceBuildId: 'source', sourceRevisionId: 'revision', references: [], revision: 1 };
describe('Guest variants kept in this browser', () => {
  let service: GuestVariantsService, api: jasmine.SpyObj<ProjectApiService>;
  beforeEach(() => {
    api = jasmine.createSpyObj('ProjectApiService', ['request']);
    api.request.and.resolveTo({ task, xml: nativeBuildingXml });
    TestBed.configureTestingModule({ providers: [{ provide: ProjectApiService, useValue: api },
      { provide: AuthService, useValue: { user: null, apiBaseUrl: 'https://guest-tests.example/api' } }] });
    service = TestBed.inject(GuestVariantsService);
  });
  afterEach(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('buildinged:guest:https%3A%2F%2Fguest-tests.example%2Fapi:')) localStorage.removeItem(key);
  });
  it('starts locally without creating a server draft and restores each independent variant', async () => {
    const first = await service.create(task, 'First'), second = await service.create(task, 'Second');
    expect(first.localId).not.toBe(second.localId);
    expect(api.request.calls.allArgs().every(args => args[0] === 'GET')).toBeTrue();
    const changed = nativeBuildingXml.replace('Office', 'Edited locally');
    localStorage.setItem(service.cacheTarget(first.localId).key, JSON.stringify({ xml: changed, revision: 1 }));
    expect(service.read(first.localId).xml).toBe(changed); expect(service.read(second.localId).xml).toBe(nativeBuildingXml);
    expect(service.forTask(task.id).map(draft => draft.contribution.name).sort()).toEqual(['First', 'Second']);
    expect(service.forTask('another-task')).toEqual([]);
  });
  it('submits only the chosen XML and entered name, using a stable retry ID', async () => {
    const draft = await service.create(task, 'My variant'); api.request.calls.reset();
    api.request.and.resolveTo({ ...draft.contribution, id: 'submitted', submitterName: 'Taylor', status: 'submitted' });
    await service.submit(draft, 'Taylor'); await service.submit(draft, 'Taylor');
    const body = api.request.calls.mostRecent().args[2]!;
    expect(body).toEqual({ xml: nativeBuildingXml, name: 'My variant', sourceRevisionId: 'revision', requestId: draft.requestId, submitterName: 'Taylor' });
    expect(api.request.calls.allArgs()[0][2]).toEqual(body);
  });
  it('keeps readable drafts available when another browser record is damaged', async () => {
    const draft = await service.create(task, 'Recoverable');
    const broken = 'buildinged:guest:https%3A%2F%2Fguest-tests.example%2Fapi:guest-broken:metadata';
    localStorage.setItem(broken, '{broken');
    expect(service.forTask(task.id).map(value => value.localId)).toEqual([draft.localId]);
    expect(service.recoveryWarning).toContain('browser data has been kept'); expect(localStorage.getItem(broken)).toBe('{broken');
  });
});
