import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TileAssetCatalogService } from './tile-asset-catalog.service';
import { TILEPACK_MANIFEST_URL } from './tile.service';

describe('Tile asset version catalog', () => {
  let catalog: TileAssetCatalogService;
  let http: HttpTestingController;
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
  const settle = () => new Promise(resolve => setTimeout(resolve));
  const index = (version: string, floor = a) => ({ format: 1, version, sheets: [
    { name: 'floor_01', path: 'Tiles/2x/floor_01.png', size: 10, sha256: floor },
    { name: 'walls_01', path: 'Tiles/2x/walls_01.png', size: 10, sha256: b },
  ] });
  async function respond(version: string, floor = a): Promise<void> {
    await settle();
    http.expectOne(TILEPACK_MANIFEST_URL).flush([{ Name: 'Vanilla', Url: `https://example.test/${version}.zip`, Version: version, SheetIndexUrl: `https://example.test/${version}.json` }]);
    await settle(); http.expectOne(`https://example.test/${version}.json`).flush(index(version, floor));
  }
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    catalog = TestBed.inject(TileAssetCatalogService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reports only changed sheet hashes and keeps unrelated dependency keys stable', async () => {
    const initial = catalog.keys(['floor_01', 'walls_01']); await respond('1'); const before = await initial;
    const changed: string[][] = []; catalog.changes$.subscribe(names => changed.push([...names]));
    const checking = catalog.check(); await respond('2', c);
    expect([...await checking]).toEqual(['floor_01']); expect(changed).toEqual([['floor_01']]);
    const after = await catalog.keys(['floor_01', 'walls_01']);
    expect(after.get('floor_01')).not.toBe(before.get('floor_01'));
    expect(after.get('walls_01')).toBe(before.get('walls_01'));
  });
  it('does not invalidate sheets just because the ZIP was repacked', async () => {
    const initial = catalog.keys(['floor_01']); await respond('1'); await initial;
    const checking = catalog.check(); await respond('2'); expect((await checking).size).toBe(0);
  });
  it('rejects a mismatched ZIP index without replacing observed sheet revisions', async () => {
    const initial = catalog.keys(['floor_01']); await respond('1'); await initial;
    const checking = catalog.check();
    const failure = expectAsync(checking).toBeRejectedWithError(/Invalid tilesheet index/);
    await settle(); http.expectOne(TILEPACK_MANIFEST_URL).flush([{ Name: 'Vanilla', Url: 'https://example.test/2.zip', Version: '2', SheetIndexUrl: 'https://example.test/wrong.json' }]);
    await settle(); http.expectOne('https://example.test/wrong.json').flush(index('1')); await failure;
  });
});
