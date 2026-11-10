import { AuthService } from './auth.service';
import { ProjectWorldDocument, ProjectWorldService } from './project-world.service';
import { TilezedSessionService } from './tilezed-session.service';

describe('TileZed hosted cell restoration', () => {
  let auth: AuthService, worlds: jasmine.SpyObj<ProjectWorldService>, sessions: TilezedSessionService;
  let uid: string;
  const reference = { projectId: 'project', mapPath: 'east/cell.tmx', cell: { x: 2, y: 1 }, lots: [], files: new Map<string, File>() };
  const cloud: ProjectWorldDocument = { projectId: 'project', name: 'world.pzw', revision: 12, updatedAt: '', updatedBy: 'admin', files: [],
    xml: '<world version="1.0" width="3" height="2"><cell x="0" y="0" map="west/cell.tmx"/>' +
      '<cell x="2" y="1" map="east/cell.tmx"><lot map="house.tbx" x="5" y="6" width="2" height="3" level="0"/></cell></world>' };

  beforeEach(() => {
    uid = `tilezed-session-test-${crypto.randomUUID()}`;
    auth = { user: { uid }, apiBaseUrl: 'https://example.test/workspaceApi' } as AuthService;
    worlds = jasmine.createSpyObj('ProjectWorldService', ['world', 'resources']);
    worlds.world.and.resolveTo(cloud);
    worlds.resources.and.resolveTo(new Map([
      ['west/cell.tmx', new File(['wrong map'], 'cell.tmx')], ['east/cell.tmx', new File(['latest saved map'], 'cell.tmx')],
      ['house.tbx', new File(['building'], 'house.tbx')],
    ]));
    sessions = new TilezedSessionService(auth, worlds);
  });
  afterEach(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('tilezed:last-cell:') && key.includes(uid)) localStorage.removeItem(key);
  });

  it('reopens the exact cell and full path using the latest authenticated world, lots and revision', async () => {
    sessions.remember(reference);
    const reopened = await new TilezedSessionService(auth, worlds).restore();
    expect(worlds.world).toHaveBeenCalledOnceWith('project');
    expect(worlds.resources).toHaveBeenCalledWith(cloud, jasmine.any(Function));
    expect(await reopened?.file.text()).toBe('latest saved map');
    expect(reopened?.buildings.mapPath).toBe('east/cell.tmx');
    expect(reopened?.buildings.cell).toEqual({ x: 2, y: 1 }); expect(reopened?.buildings.worldRevision).toBe(12);
    expect(reopened?.buildings.lots[0]).toEqual({ map: 'house.tbx', x: 5, y: 6, width: 2, height: 3, level: 0 });
    expect(reopened?.buildings.files.has('house.tbx')).toBeTrue();
    const key = Object.keys(localStorage).find(key => key.startsWith('tilezed:last-cell:') && key.includes(uid))!;
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ projectId: 'project', mapPath: 'east/cell.tmx', cell: { x: 2, y: 1 } });
  });

  it('isolates selections by account and API and stops an in-flight restore after an account change', async () => {
    sessions.remember(reference);
    Object.assign(auth, { user: { uid: 'someone-else' } }); expect(await sessions.restore()).toBeUndefined();
    Object.assign(auth, { user: { uid }, apiBaseUrl: 'https://other.test/workspaceApi' }); expect(await sessions.restore()).toBeUndefined();
    expect(worlds.world).not.toHaveBeenCalled();
    Object.assign(auth, { apiBaseUrl: 'https://example.test/workspaceApi' });
    worlds.world.and.callFake(async () => { Object.assign(auth, { user: null }); return cloud; });
    await expectAsync(sessions.restore()).toBeRejectedWithError(/account changed/);
    expect(worlds.resources).not.toHaveBeenCalled();
  });

  it('clears the hosted selection when a local map is opened', async () => {
    sessions.remember(reference); sessions.remember();
    expect(await sessions.restore()).toBeUndefined(); expect(worlds.world).not.toHaveBeenCalled();
  });

  it('preserves access errors and refuses missing or reassigned cells instead of selecting another map', async () => {
    sessions.remember(reference); worlds.world.and.rejectWith(new Error('Membership removed.'));
    await expectAsync(sessions.restore()).toBeRejectedWithError('Membership removed.');
    worlds.world.and.resolveTo(null); await expectAsync(sessions.restore()).toBeRejectedWithError(/no longer available/);
    worlds.world.and.resolveTo({ ...cloud, xml: cloud.xml.replace('east/cell.tmx', 'replacement.tmx') });
    await expectAsync(sessions.restore()).toBeRejectedWithError(/cell map changed/);
    expect(worlds.resources).not.toHaveBeenCalled();
  });
});
