import { HttpClient } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TilezedTileset } from '../utils/tilezed-map';
import { DbService } from './db.service';
import { TileService, TILEPACK_MANIFEST_URL } from './tile.service';
import { TilezedArchiveService } from './tilezed-archive.service';
import { TilezedAssetsService } from './tilezed-assets.service';
import { TilezedStorageService } from './tilezed-storage.service';

describe('TileZed tile sources', () => {
  let service: TilezedAssetsService;
  let http: HttpTestingController;
  let getBuildingEdSheet: jasmine.Spy;
  let storage: jasmine.SpyObj<TilezedStorageService>;
  let archives: jasmine.SpyObj<TilezedArchiveService>;
  let tileService: jasmine.SpyObj<TileService>;
  let oldPackSetting: string | null;

  const sheet = (name: string, firstGid: number): TilezedTileset => ({
    name, source: `Tiles/${name}.png`, firstGid, tileWidth: 64, tileHeight: 128,
    imageWidth: 64, imageHeight: 128, columns: 1, rows: 1,
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const png = new Blob(['image'], { type: 'image/png' });
  const vanillaUrl = 'https://example.test/vanilla.zip';
  const customUrl = 'https://example.test/custom.json';

  beforeEach(() => {
    oldPackSetting = localStorage.getItem('TilezedTestPack');
    localStorage.removeItem('TilezedTestPack');
    getBuildingEdSheet = jasmine.createSpy('get').and.resolveTo(undefined);
    storage = jasmine.createSpyObj<TilezedStorageService>('TilezedStorageService', ['sheet', 'rememberSheet']);
    storage.sheet.and.resolveTo(undefined);
    storage.rememberSheet.and.resolveTo();
    archives = jasmine.createSpyObj<TilezedArchiveService>('TilezedArchiveService', ['load']);
    archives.load.and.resolveTo({ sheets: new Map(), errors: new Map() });
    tileService = jasmine.createSpyObj<TileService>('TileService', ['fetchTilesheet'], { tilepacks: [] });
    tileService.fetchTilesheet.and.returnValue(of(png));
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        TilezedAssetsService,
        { provide: DbService, useValue: { sheetImages: { get: getBuildingEdSheet } } },
        { provide: TilezedStorageService, useValue: storage },
        { provide: TilezedArchiveService, useValue: archives },
        { provide: TileService, useValue: tileService },
      ],
    });
    service = TestBed.inject(TilezedAssetsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    if (oldPackSetting === null) localStorage.removeItem('TilezedTestPack');
    else localStorage.setItem('TilezedTestPack', oldPackSetting);
  });

  it('reuses BuildingEd sheets without requesting the manifest or a folder', async () => {
    getBuildingEdSheet.and.resolveTo({ name: 'grass_01', blob: png });

    const result = await service.load([sheet('grass_01', 1)]);

    expect(result.sheets.get(1)).toBe(png);
    expect(result.errors.size).toBe(0);
    expect(storage.sheet).not.toHaveBeenCalled();
    expect(archives.load).not.toHaveBeenCalled();
    http.expectNone(TILEPACK_MANIFEST_URL);
  });

  it('reads the actual BuildingEd IndexedDB cache before requesting a tilepack', async () => {
    const name = `tilezed-test-${Date.now()}-${Math.random()}`;
    const db = new DbService();
    const viewerStorage = new TilezedStorageService(`${name}-storage`);
    const loader = new TilezedAssetsService(db, viewerStorage, TestBed.inject(HttpClient), tileService, archives);
    try {
      await db.sheetImages.put({ name, blob: png });
      const result = await loader.load([sheet(name, 1)]);
      expect(await result.sheets.get(1)?.text()).toBe('image');
      http.expectNone(TILEPACK_MANIFEST_URL);
    } finally {
      await db.sheetImages.delete(name);
      db.close();
      await viewerStorage.delete();
    }
  });

  it('reuses a previously fetched 1x sheet when BuildingEd did not cache it', async () => {
    storage.sheet.and.resolveTo(png);

    const result = await service.load([sheet('vegetation_01', 1)]);

    expect(result.sheets.get(1)).toBe(png);
    expect(archives.load).not.toHaveBeenCalled();
    http.expectNone(TILEPACK_MANIFEST_URL);
  });

  it('downloads just missing sheets from the configured vanilla pack and caches them', async () => {
    archives.load.and.resolveTo({ sheets: new Map([['vegetation_01', png]]), errors: new Map() });
    const loading = service.load([sheet('vegetation_01', 7)]);
    await settle();
    http.expectOne(TILEPACK_MANIFEST_URL).flush([{ Name: 'Vanilla', Url: vanillaUrl, Version: '2' }]);

    const result = await loading;

    expect(archives.load).toHaveBeenCalledOnceWith(vanillaUrl, ['vegetation_01']);
    expect(result.sheets.get(7)).toBe(png);
    expect(storage.rememberSheet).toHaveBeenCalledOnceWith({
      name: 'vegetation_01', blob: png, packName: 'Vanilla', version: '2',
    });
    expect(result.errors.size).toBe(0);
  });

  it('reuses BuildingEd tiles while fetching only the missing 1x sheet', async () => {
    getBuildingEdSheet.and.callFake(async (name: string) => name === 'grass_01' ? { name, blob: png } : undefined);
    const vegetation = new Blob(['vegetation'], { type: 'image/png' });
    archives.load.and.resolveTo({ sheets: new Map([['vegetation_01', vegetation]]), errors: new Map() });
    const loading = service.load([sheet('grass_01', 1), sheet('vegetation_01', 2)]);
    await settle();
    http.expectOne(TILEPACK_MANIFEST_URL).flush([{ Name: 'Vanilla', Url: vanillaUrl }]);

    const result = await loading;

    expect(result.sheets.get(1)).toBe(png);
    expect(result.sheets.get(2)).toBe(vegetation);
    expect(archives.load).toHaveBeenCalledOnceWith(vanillaUrl, ['vegetation_01']);
    expect(storage.rememberSheet).toHaveBeenCalledTimes(1);
    expect(result.errors.size).toBe(0);
  });

  it('uses enabled JSON packs after checking the base pack', async () => {
    localStorage.setItem('TilezedTestPack', '1');
    const loading = service.load([sheet('custom_01', 3)]);
    await settle();
    http.expectOne(TILEPACK_MANIFEST_URL).flush([
      { Name: 'Vanilla', Url: vanillaUrl },
      { Name: 'TilezedTestPack', Url: customUrl },
      { Name: 'Disabled', Url: 'https://example.test/disabled.json' },
    ]);
    await settle();
    http.expectOne(customUrl).flush([{ name: 'custom_01', url: 'https://example.test/custom_01.png' }]);

    const result = await loading;

    expect(tileService.fetchTilesheet).toHaveBeenCalledOnceWith('https://example.test/custom_01.png');
    expect(result.sheets.get(3)).toBe(png);
    expect(storage.rememberSheet).toHaveBeenCalledOnceWith({
      name: 'custom_01', blob: png, packName: 'TilezedTestPack', version: 'unversioned',
    });
    http.expectNone('https://example.test/disabled.json');
  });

  it('reports a tilepack failure instead of presenting a missing sheet as loaded', async () => {
    spyOn(console, 'warn');
    archives.load.and.rejectWith(new Error('Offline'));
    const loading = service.load([sheet('grass_01', 1)]);
    await settle();
    http.expectOne(TILEPACK_MANIFEST_URL).flush([{ Name: 'Vanilla', Url: vanillaUrl }]);

    const result = await loading;

    expect(result.sheets.size).toBe(0);
    expect(result.errors.get(1)).toContain('Offline');
    expect(console.warn).toHaveBeenCalled();
  });

  it('still renders a downloaded sheet while reporting a cache write failure', async () => {
    archives.load.and.resolveTo({ sheets: new Map([['grass_01', png]]), errors: new Map() });
    storage.rememberSheet.and.rejectWith(new Error('Storage is full'));
    const loading = service.load([sheet('grass_01', 1)]);
    await settle();
    http.expectOne(TILEPACK_MANIFEST_URL).flush([{ Name: 'Vanilla', Url: vanillaUrl }]);

    const result = await loading;

    expect(result.sheets.get(1)).toBe(png);
    expect(result.warnings.join(' ')).toContain('Storage is full');
  });
});
