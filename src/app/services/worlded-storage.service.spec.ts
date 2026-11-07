import { LOCAL_FILE_SNAPSHOT_VERSION } from '../utils/local-file-snapshot';
import { WORLDED_SNAPSHOT_LIMIT, WorldedSavedProject, WorldedStorageService } from './worlded-storage.service';

describe('WorldEd browser storage', () => {
  let storage: WorldedStorageService;
  const project = (name = 'world.pzw'): WorldedSavedProject => ({
    worldFile: new File(['<world/>'], name, { type: 'text/xml', lastModified: 42 }),
    files: new Map([['maps/cell.tmx', new File(['map'], 'cell.tmx', { lastModified: 12 })]]),
    folderName: 'Project', warnings: [], omittedResources: 0,
  });

  beforeEach(() => {
    storage = new WorldedStorageService(`worlded-test-${Date.now()}-${Math.random()}`);
  });

  afterEach(async () => { await storage.delete(); });

  it('restores a local world snapshot and its referenced resources', async () => {
    const value = project();
    const worldRead = spyOn(value.worldFile, 'arrayBuffer').and.callThrough();
    const mapRead = spyOn(value.files.get('maps/cell.tmx')!, 'arrayBuffer').and.callThrough();
    const snapshot = await storage.rememberWorld(value);
    const saved = await storage.lastWorld();
    expect(snapshot.omittedResources).toBe(0);
    expect(snapshot.worldFile).not.toBe(value.worldFile);
    expect(snapshot.files.get('maps/cell.tmx')).not.toBe(value.files.get('maps/cell.tmx'));
    expect(await snapshot.files.get('maps/cell.tmx')?.text()).toBe('map');
    expect(worldRead).toHaveBeenCalledTimes(1);
    expect(mapRead).toHaveBeenCalledTimes(1);
    expect(saved?.worldFile.name).toBe('world.pzw');
    expect(saved?.worldFile.lastModified).toBe(42);
    expect(await saved?.worldFile.text()).toBe('<world/>');
    expect(await saved?.files.get('maps/cell.tmx')?.text()).toBe('map');
    expect(saved?.folderName).toBe('Project');
  });

  it('keeps writes ordered and permits a later write after a failure', async () => {
    storage.close();
    await expectAsync(storage.rememberWorld(project('failed.pzw'))).toBeRejected();
    await storage.open();
    await Promise.all([storage.rememberWorld(project('first.pzw')), storage.rememberWorld(project('last.pzw'))]);
    expect((await storage.lastWorld())?.worldFile.name).toBe('last.pzw');
  });

  it('reports resources omitted from a snapshot exceeding its size limit', async () => {
    const large = new File(['image'], 'large.png');
    const read = spyOn(large, 'arrayBuffer').and.callThrough();
    Object.defineProperty(large, 'size', { value: WORLDED_SNAPSHOT_LIMIT + 1 });
    const value = project();
    value.files.set('large.png', large);

    expect((await storage.rememberWorld(value)).omittedResources).toBe(1);
    const saved = await storage.lastWorld();
    expect(saved?.omittedResources).toBe(1);
    expect(saved?.files.has('large.png')).toBeFalse();
    expect(saved?.files.has('maps/cell.tmx')).toBeTrue();
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps the previous snapshot when a project file cannot be copied', async () => {
    await storage.rememberWorld(project('previous.pzw'));
    const broken = project('new.pzw');
    spyOn(broken.files.get('maps/cell.tmx')!, 'arrayBuffer').and.rejectWith(new Error('File no longer available'));

    await expectAsync(storage.rememberWorld(broken)).toBeRejectedWithError(/cell\.tmx.*File no longer available/);
    expect((await storage.lastWorld())?.worldFile.name).toBe('previous.pzw');
  });

  it('upgrades a readable legacy snapshot without overwriting a later selection', async () => {
    const legacy = project('legacy.pzw');
    const record = (file: File) => ({ name: file.name, blob: file, type: file.type, lastModified: file.lastModified });
    const legacyRecord = {
      id: 'last', world: record(legacy.worldFile),
      resources: [{ path: 'maps/cell.tmx', ...record(legacy.files.get('maps/cell.tmx')!) }],
      folderName: legacy.folderName, warnings: [], omittedResources: 0,
    };
    await storage.table('worlds').put(legacyRecord);

    const restored = await storage.lastWorld();
    expect(await restored?.files.get('maps/cell.tmx')?.text()).toBe('map');
    expect((await storage.table<{ snapshotVersion?: number }, string>('worlds').get('last'))?.snapshotVersion)
      .toBe(LOCAL_FILE_SNAPSHOT_VERSION);

    await storage.table('worlds').put(legacyRecord);
    await Promise.all([storage.lastWorld(), storage.rememberWorld(project('new.pzw'))]);
    expect((await storage.lastWorld())?.worldFile.name).toBe('new.pzw');
  });
});
