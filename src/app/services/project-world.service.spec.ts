import { AuthService } from './auth.service';
import { ProjectApiService, ProjectRequestError } from './project-api.service';
import { ProjectWorldCacheService, worldFileHash } from './project-world-cache.service';
import { ProjectWorldDocument, ProjectWorldService } from './project-world.service';

const xml = '<world version="1.0" width="1" height="1"/>';
function world(files: ProjectWorldDocument['files'] = [], revision = 1): ProjectWorldDocument {
  return { projectId: 'p', name: 'world.pzw', revision, xml, files, updatedAt: '2026-11-08T12:00:00Z', updatedBy: 'admin' };
}
describe('Project world downloads and synchronization', () => {
  let api: jasmine.SpyObj<ProjectApiService>, service: ProjectWorldService, cache: ProjectWorldCacheService, auth: AuthService;
  let uid: string, database: string;
  const hash = (text: string) => worldFileHash(new TextEncoder().encode(text).buffer);
  function respond(handler: (method: string, path: string, body?: object) => unknown): void {
    api.request.and.callFake(async <T>(method: string, path: string, body?: object): Promise<T> => await handler(method, path, body) as T);
  }
  function downloads(): string[] {
    return api.request.calls.allArgs().filter(([method, path]) => method === 'GET' && path.startsWith('/world-files/')).map(args => args[1]);
  }
  beforeEach(() => {
    uid = 'member'; database = `project-world-test-${crypto.randomUUID()}`;
    cache = new ProjectWorldCacheService(database);
    auth = { get user() { return { uid }; }, apiBaseUrl: 'https://example.test/workspaceApi' } as unknown as AuthService;
    api = jasmine.createSpyObj('ProjectApiService', ['request']);
    service = new ProjectWorldService(api, auth, cache);
  });
  afterEach(async () => { await cache.delete(); });

  it('retrieves just the selected building and reuses it from the persistent cache', async () => {
    const entry = { id: 'building', path: 'folder/house.tbx', size: 1, sha256: await hash('a') };
    const cloud = world([entry, { id: 'map', path: 'world.tmx', size: 1 }]);
    respond(() => ({ data: btoa('a') }));
    expect(await (await service.file(cloud, entry)).text()).toBe('a');
    expect((await service.file(cloud, entry)).name).toBe('house.tbx');
    expect(downloads()).toEqual(['/world-files/building']);
    await expectAsync(service.file(cloud, { ...entry, id: 'other' })).toBeRejectedWithError(/not part/);
    expect(downloads()).toEqual(['/world-files/building']);
  });

  it('downloads once, persists across database reopening, and checks only the revision on later visits', async () => {
    const cloud = world([{ id: 'one', path: 'map.tmx', size: 3 }]);
    respond((_method, path) => path.endsWith('/world-status') ? { revision: 1 } : path.endsWith('/world') ? cloud : { data: 'AID/' });
    await service.resources((await service.world('p'))!, () => {});
    expect(downloads()).toEqual(['/world-files/one']);
    cache.close(); cache = new ProjectWorldCacheService(database);
    service = new ProjectWorldService(api, auth, cache);
    api.request.calls.reset();
    const files = await service.resources((await service.world('p'))!, () => {});
    expect([...new Uint8Array(await files.get('map.tmx')!.arrayBuffer())]).toEqual([0, 128, 255]);
    expect(api.request).toHaveBeenCalledOnceWith('GET', '/projects/p/world-status');
  });
  it('reuses unchanged content when upload IDs change, downloads only changed files, and drops removed files', async () => {
    let cloud = world([{ id: 'keep-old', path: 'keep.tbx', size: 4 },
      { id: 'change-old', path: 'change.tmx', size: 3 }, { id: 'remove', path: 'remove.tbx', size: 3 }]);
    const bodies: Record<string, string> = { 'keep-old': 'keep', 'change-old': 'old', remove: 'bye', 'change-new': 'new' };
    respond((_method, path) => path.endsWith('/world-status') ? { revision: cloud.revision } :
      path.endsWith('/world') ? cloud : { data: btoa(bodies[path.split('/').pop()!]) });
    const before = await service.resources((await service.world('p'))!, () => {});
    cloud = world([{ id: 'keep-new', path: 'keep.tbx', size: 4, sha256: await hash('keep') },
      { id: 'change-new', path: 'change.tmx', size: 3, sha256: await hash('new') }], 2);
    api.request.calls.reset();
    const after = await service.resources((await service.world('p'))!, () => {});
    expect(downloads()).toEqual(['/world-files/change-new']);
    expect(after.get('keep.tbx')).toBe(before.get('keep.tbx'));
    expect(await after.get('change.tmx')!.text()).toBe('new');
    expect(after.has('remove.tbx')).toBeFalse();
    expect(await cache.table('blobs').count()).toBe(2);
    service = new ProjectWorldService(api, auth, cache);
    api.request.calls.reset();
    await service.resources((await service.world('p'))!, () => {});
    expect(downloads()).toEqual([]);
  });
  it('reuses all files when only the PZW changes', async () => {
    let cloud = world([{ id: 'one', path: 'map.tmx', size: 1 }]);
    respond((_method, path) => path.endsWith('/world-status') ? { revision: cloud.revision } : path.endsWith('/world') ? cloud : { data: btoa('a') });
    const first = await service.resources((await service.world('p'))!, () => {});
    cloud = { ...cloud, revision: 2, xml: xml.replace('width="1"', 'width="2"') };
    api.request.calls.reset();
    const latest = (await service.world('p'))!;
    const second = await service.resources(latest, () => {});
    expect(latest.xml).toContain('width="2"');
    expect(second.get('map.tmx')).toBe(first.get('map.tmx'));
    expect(downloads()).toEqual([]);
  });
  it('checks membership before reading cached worlds and scopes files to the signed-in account', async () => {
    const cloud = world([{ id: 'one', path: 'map.tmx', size: 1 }]);
    respond((_method, path) => path.endsWith('/world-status') ? { revision: 1 } : path.endsWith('/world') ? cloud : { data: btoa('a') });
    await service.resources((await service.world('p'))!, () => {});
    respond(() => { throw new ProjectRequestError('Membership removed.', 403); });
    await expectAsync(service.world('p')).toBeRejectedWithError('Membership removed.');
    uid = 'another-member';
    respond((_method, path) => path.endsWith('/world') ? cloud : { data: btoa('a') });
    api.request.calls.reset();
    await service.resources((await service.world('p'))!, () => {});
    expect(downloads()).toEqual(['/world-files/one']);
  });
  it('resumes interrupted downloads without fetching completed files again', async () => {
    const cloud = world([{ id: 'one', path: 'one.tmx', size: 1 }, { id: 'two', path: 'two.tmx', size: 1 }]);
    respond(async (_method, path) => {
      if (path.endsWith('/world')) return cloud;
      if (path.endsWith('/one')) return { data: btoa('a') };
      await new Promise(resolve => setTimeout(resolve, 50));
      throw new Error('Connection lost');
    });
    await expectAsync(service.resources((await service.world('p'))!, () => {})).toBeRejectedWithError('Connection lost');
    service = new ProjectWorldService(api, auth, cache);
    respond(() => ({ data: btoa('b') })); api.request.calls.reset();
    await service.resources(cloud, () => {});
    expect(downloads()).toEqual(['/world-files/two']);
  });
  it('bounds concurrency and coalesces overlapping downloads', async () => {
    const cloud = world(Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, path: `${i}.tmx`, size: 1 })));
    let active = 0, maximum = 0;
    respond(async () => {
      active++; maximum = Math.max(active, maximum);
      await new Promise(resolve => setTimeout(resolve, 10)); active--;
      return { data: btoa('a') };
    });
    await Promise.all([service.resources(cloud, () => {}), service.resources(cloud, () => {})]);
    expect(downloads().length).toBe(6); expect(maximum).toBeLessThanOrEqual(3);
  });
  it('rejects corrupt resource bytes before caching them', async () => {
    respond(() => ({ data: btoa('b') }));
    await expectAsync(service.resources(world([{ id: 'one', path: 'one.tmx', size: 1, sha256: await hash('a') }]), () => {}))
      .toBeRejectedWithError(/checksum/);
    expect(await cache.table('blobs').count()).toBe(0);
  });
  it('keeps the world usable and reports browser storage failures', async () => {
    spyOn(cache, 'rememberFile').and.rejectWith(new Error('Quota exceeded'));
    respond(() => ({ data: btoa('a') }));
    const files = await service.resources(world([{ id: 'one', path: 'one.tmx', size: 1 }]), () => {});
    expect(await files.get('one.tmx')!.text()).toBe('a'); expect(service.cacheWarning).toContain('could not save');
  });
  it('supports the existing API without a deployment', async () => {
    respond((_method, path) => {
      if (path.endsWith('/world-status')) throw new ProjectRequestError('Endpoint not found.', 404);
      return world();
    });
    await service.world('p'); await service.world('p'); api.request.calls.reset(); await service.world('p');
    expect(api.request).toHaveBeenCalledOnceWith('GET', '/projects/p/world');
  });
  it('uploads only changed resources and remembers local bytes for subsequent visits', async () => {
    const cloud = world([{ id: 'keep', path: 'keep.tbx', size: 4, sha256: await hash('keep') }]);
    respond((method, path) => {
      if (method === 'GET') return cloud;
      return path.endsWith('/world-files') ? { id: 'changed' } : world([cloud.files[0], { id: 'changed', path: 'new.tmx', size: 3 }], 2);
    });
    await service.upload('p', { worldFile: new File([xml], 'world.pzw'), files: new Map([
      ['keep.tbx', new File(['keep'], 'keep.tbx')], ['new.tmx', new File(['new'], 'new.tmx')],
    ]), folderName: 'Project', warnings: [], omittedResources: 0 }, 1, () => {});
    const uploads = api.request.calls.allArgs().filter(([method, path]) => method === 'POST' && path.endsWith('/world-files'));
    expect(uploads.length).toBe(1);
    expect(uploads[0][2]).toEqual(jasmine.objectContaining({ path: 'new.tmx', data: btoa('new') }));
    expect(api.request.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({ fileIds: ['keep', 'changed'] }));
    api.request.calls.reset();
    await service.resources(world([cloud.files[0], { id: 'changed', path: 'new.tmx', size: 3 }], 2), () => {});
    expect(downloads()).toEqual([]);
  });
  it('keeps save conflicts and rejects incomplete snapshots before uploading', async () => {
    respond(() => { throw new Error('World changed'); });
    await expectAsync(service.save('p', xml, 4)).toBeRejectedWithError('World changed'); api.request.calls.reset();
    await expectAsync(service.upload('p', { worldFile: new File([xml], 'world.pzw'), files: new Map(),
      folderName: '', warnings: [], omittedResources: 1 }, 0, () => {})).toBeRejected();
    expect(api.request).not.toHaveBeenCalled();
  });
});
