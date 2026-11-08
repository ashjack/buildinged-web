import { LOCAL_FILE_SNAPSHOT_VERSION } from '../utils/local-file-snapshot';
import { TilezedStorageService } from './tilezed-storage.service';

describe('TileZed browser storage', () => {
  let storage: TilezedStorageService;
  const versionKey = 'tilepack-version:TilezedStorageTest';
  let oldVersion: string | null;

  beforeEach(() => {
    oldVersion = localStorage.getItem(versionKey);
    storage = new TilezedStorageService(`tilezed-test-${Date.now()}-${Math.random()}`);
  });

  afterEach(async () => {
    await storage.delete();
    if (oldVersion === null) localStorage.removeItem(versionKey);
    else localStorage.setItem(versionKey, oldVersion);
  });

  it('reconstructs the saved TMX from its browser-local copy', async () => {
    const source = new File(['<map/>'], 'last.tmx', { type: 'text/xml', lastModified: 123 });
    const read = spyOn(source, 'arrayBuffer').and.callThrough();
    await storage.rememberMap(source);

    const file = await storage.lastMap();

    expect(read).toHaveBeenCalledTimes(1);
    expect(file?.name).toBe('last.tmx');
    expect(file?.lastModified).toBe(123);
    expect(await file?.text()).toBe('<map/>');
  });

  it('persists lot placements and copies only their building resources', async () => {
    const file = new File(['<map/>'], 'cell.tmx');
    const lot = { x: 2, y: 3, width: 4, height: 5, level: 1, map: 'Buildings/house.tbx' };
    await storage.rememberMap(file, { lots: [lot], files: new Map([
      ['Buildings/house.tbx', new File(['building'], 'house.tbx')], ['other.tmx', new File(['private'], 'other.tmx')],
    ]) });
    const restored = await storage.lastMap();
    const buildings = await storage.lastBuildings(restored!);
    expect(buildings?.lots).toEqual([lot]);
    expect(buildings?.files.size).toBe(1);
    expect(await buildings?.files.get('Buildings/house.tbx')?.text()).toBe('building');
    expect(await storage.lastBuildings(new File(['other'], 'different.tmx'))).toBeUndefined();
  });

  it('orders map writes so the last successful selection is remembered', async () => {
    const writes = ['one', 'two', 'three'].map(name =>
      storage.rememberMap(new File([name], `${name}.tmx`)));

    await Promise.all(writes);

    expect((await storage.lastMap())?.name).toBe('three.tmx');
  });

  it('allows a later map write after an earlier storage failure', async () => {
    storage.close();
    await expectAsync(storage.rememberMap(new File(['one'], 'one.tmx'))).toBeRejected();

    await storage.open();
    await expectAsync(storage.rememberMap(new File(['two'], 'two.tmx'))).toBeResolved();
    expect((await storage.lastMap())?.name).toBe('two.tmx');
  });

  it('keeps the previous map when the selected file cannot be copied', async () => {
    await storage.rememberMap(new File(['previous'], 'previous.tmx'));
    const missing = new File(['new'], 'new.tmx');
    spyOn(missing, 'arrayBuffer').and.rejectWith(new Error('File no longer available'));

    await expectAsync(storage.rememberMap(missing)).toBeRejectedWithError(/new\.tmx.*File no longer available/);
    expect((await storage.lastMap())?.name).toBe('previous.tmx');
  });

  it('upgrades a readable legacy map without overwriting a later selection', async () => {
    const file = new File(['legacy'], 'legacy.tmx', { type: 'text/xml', lastModified: 42 });
    const legacy = { id: 'last', name: file.name, blob: file, type: file.type, lastModified: file.lastModified };
    await storage.table('maps').put(legacy);

    expect(await (await storage.lastMap())?.text()).toBe('legacy');
    expect((await storage.table<{ snapshotVersion?: number }, string>('maps').get('last'))?.snapshotVersion)
      .toBe(LOCAL_FILE_SNAPSHOT_VERSION);

    await storage.table('maps').put(legacy);
    await Promise.all([storage.lastMap(), storage.rememberMap(new File(['new'], 'new.tmx'))]);
    expect((await storage.lastMap())?.name).toBe('new.tmx');
  });

  it('refreshes an automatically cached sheet when BuildingEd changes its pack version', async () => {
    const blob = new Blob(['sheet']);
    localStorage.setItem(versionKey, '1');
    await storage.rememberSheet({ name: 'grass', blob, packName: 'TilezedStorageTest', version: '2' });
    expect(await (await storage.sheet('grass'))?.text()).toBe('sheet');

    localStorage.setItem(versionKey, '2');
    expect(await storage.sheet('grass')).toBeUndefined();
  });

  it('persists building thumbnails and retrieves them by their content/configuration key', async () => {
    const preview = { blob: new Blob(['thumbnail']), width: 10, height: 20, squares: { minX: 0, minY: 0, maxX: 3, maxY: 4 },
      bounds: { left: -5, right: 5, top: -20, bottom: 0 }, warnings: [] };
    await storage.rememberBuildingPreview('content-version-1', preview);
    const cached = await storage.buildingPreview('content-version-1');
    expect(await cached?.blob.text()).toBe('thumbnail');
    expect(cached?.squares).toEqual(preview.squares);
    expect(await storage.buildingPreview('content-version-2')).toBeUndefined();
    await storage.rememberBuildingPreview('without-squares', { ...preview, squares: undefined! });
    await expectAsync(storage.buildingPreview('without-squares')).toBeRejectedWithError(/invalid/);
  });

  it('tracks the thumbnail cache size without rescanning it on every write', async () => {
    const preview = { blob: new Blob(['12345']), width: 1, height: 1, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      bounds: { left: 0, right: 1, top: 0, bottom: 1 }, warnings: [] };
    const table = storage.table('buildingPreviews');
    await storage.rememberBuildingPreview('one', preview);
    const scan = spyOn(Object.getPrototypeOf(table), 'orderBy').and.callThrough();
    await storage.rememberBuildingPreview('one', preview);
    await storage.rememberBuildingPreview('two', preview);
    expect(scan).not.toHaveBeenCalled();
    expect((storage as unknown as { buildingPreviewBytes: number }).buildingPreviewBytes).toBe(10);

    (storage as unknown as { buildingPreviewBytes: number }).buildingPreviewBytes = 256 * 1024 * 1024;
    await storage.rememberBuildingPreview('three', preview);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(await table.count()).toBe(3);
    expect((storage as unknown as { buildingPreviewBytes: number }).buildingPreviewBytes).toBe(15);
  });
});
