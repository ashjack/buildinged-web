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
    await storage.rememberMap(new File(['<map/>'], 'last.tmx', { type: 'text/xml', lastModified: 123 }));

    const file = await storage.lastMap();

    expect(file?.name).toBe('last.tmx');
    expect(file?.lastModified).toBe(123);
    expect(await file?.text()).toBe('<map/>');
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

  it('refreshes an automatically cached sheet when BuildingEd changes its pack version', async () => {
    const blob = new Blob(['sheet']);
    localStorage.setItem(versionKey, '1');
    await storage.rememberSheet({ name: 'grass', blob, packName: 'TilezedStorageTest', version: '2' });
    expect(await (await storage.sheet('grass'))?.text()).toBe('sheet');

    localStorage.setItem(versionKey, '2');
    expect(await storage.sheet('grass')).toBeUndefined();
  });
});
