import { TestBed } from '@angular/core/testing';
import { TilezedAssetsService } from './tilezed-assets.service';
import { BuildingPreviewService } from './building-preview.service';
import { BuildingLots } from './building-lots';
import { TilezedStorageService } from './tilezed-storage.service';

const xml = `<building version="3" width="1" height="1">
  <tile_entry category="floors"><tile enum="Floor" tile="floor_01_000"/></tile_entry>
  <room Name="Room" Floor="1"/>
  <floor><rooms>1</rooms></floor>
</building>`;

describe('Background building previews', () => {
  let service: BuildingPreviewService;
  let assets: jasmine.SpyObj<TilezedAssetsService>;
  let storage: jasmine.SpyObj<TilezedStorageService>;

  beforeEach(() => {
    assets = jasmine.createSpyObj('TilezedAssetsService', ['load', 'configurationKey', 'sheetKeys']);
    assets.configurationKey.and.resolveTo('test');
    assets.sheetKeys.and.callFake(async names => new Map(names.map(name => [name, 'test'])));
    storage = jasmine.createSpyObj('TilezedStorageService', ['buildingPreview', 'rememberBuildingPreview']);
    storage.buildingPreview.and.resolveTo(undefined);
    storage.rememberBuildingPreview.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      { provide: TilezedAssetsService, useValue: assets }, { provide: TilezedStorageService, useValue: storage },
    ] });
    service = TestBed.inject(BuildingPreviewService);
  });

  it('picks a building source tile through transparent pixels of a tile in front', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillRect(0, 0, 64, 128);
    const floor = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    context.clearRect(0, 0, 512, 128); context.fillRect(0, 0, 32, 128);
    const furniture = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.callFake(async sheets => ({ sheets: new Map(sheets.map(sheet => [sheet.firstGid, sheet.name === 'floor_01' ? floor : furniture])), errors: new Map(), warnings: [] }));
    const manual = xml.replace('<floor>', '<user_tiles><tile tile="furniture_01_0"/></user_tiles><floor>')
      .replace('</floor>', '<tiles layer="Furniture">1,0,0,0</tiles></floor>');
    const file = new File([manual], 'house.tbx');
    expect(await service.pickTile(file, 0, -16, -32)).toEqual({ sheet: 'furniture_01', index: 0 });
    expect(await service.pickTile(file, 0, 16, -32)).toEqual({ sheet: 'floor_01', index: 0 });
    expect(await service.pickTile(file, 0, 50, -32)).toBeUndefined();
    const lots = new BuildingLots(service);
    await lots.load([{ lot: { x: 0, y: 0, width: 1, height: 1, level: 0, map: file.name }, x: 100, y: 200, scale: 2 }],
      new Map([[file.name, file]]), () => undefined);
    expect(await lots.pickTile(68, 136)).toEqual({ sheet: 'furniture_01', index: 0 });
    expect(await lots.pickTile(132, 136)).toEqual({ sheet: 'floor_01', index: 0 });
    lots.dispose();
  });

  it('generates a preview in a worker and caches repeated buildings without reloading sheets', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.resolveTo({ sheets: new Map([[1, blob]]), warnings: [], errors: new Map() });
    const file = new File([xml], 'house.tbx');
    const [first, second] = await Promise.all([service.preview(file), service.preview(file)]);
    expect(second).toBe(first);
    expect(first.warnings).toEqual([]);
    expect(first.bounds).toEqual({ left: -32, right: 32, top: -96, bottom: 32 });
    expect(assets.load).toHaveBeenCalledTimes(1);
    expect(storage.rememberBuildingPreview).toHaveBeenCalledTimes(1);
    const lots = new BuildingLots(service);
    const lot = { x: 0, y: 0, width: 1, height: 1, level: 0, map: 'house.tbx' };
    await lots.load([{ lot, x: 0, y: 0, scale: 1 }, { lot, x: 100, y: 0, scale: 1 }],
      new Map([['house.tbx', file]]), () => undefined);
    expect(lots.loaded).toBe(2);
    expect(lots.sprites[0].bitmap).toBe(lots.sprites[1].bitmap);
    lots.dispose();
    expect(lots.sprites.length).toBe(0);
  });

  it('stores fixed-width thumbnails and caches previews whose only gaps are missing tilepack sheets', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const wide = `<building version="3" width="8" height="1">
  <tile_entry category="floors"><tile enum="Floor" tile="floor_01_000"/></tile_entry>
  <tile_entry category="floors"><tile enum="Floor" tile="modded_floor_01_0"/></tile_entry>
  <room Name="Room" Floor="1"/>
  <room Name="Modded" Floor="2"/>
  <floor><rooms>1,1,1,1,1,1,1,2</rooms></floor>
</building>`;
    assets.load.and.callFake(async sheets => ({
      sheets: new Map(sheets.filter(sheet => sheet.name === 'floor_01').map(sheet => [sheet.firstGid, blob])),
      errors: new Map(sheets.filter(sheet => sheet.name !== 'floor_01')
        .map(sheet => [sheet.firstGid, `${sheet.name}: sheet not found in configured tilepacks`])),
      warnings: [],
    }));
    const preview = await service.preview(new File([wide], 'wide.tbx'), 0, 128);
    expect(preview.width).toBe(128);
    expect(preview.warnings.some(warning => warning.endsWith('sheet not found in configured tilepacks'))).toBeTrue();
    expect(storage.rememberBuildingPreview).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.rememberBuildingPreview.calls.mostRecent().args[0])[3]).toBe(128);
  });

  it('renders a manual-only roof on an upper-floor border through the worker', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#00ff00';
    context.fillRect(0, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.callFake(async sheets => ({
      sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), warnings: [], errors: new Map(),
    }));
    const manual = `<building version="3" width="1" height="1">
      <user_tiles><tile tile="manual_roof_01_0"/></user_tiles>
      <floor><rooms>0</rooms></floor>
      <floor><rooms>0</rooms><tiles layer="Roof">0,0,0,1</tiles></floor>
    </building>`;
    const preview = await service.preview(new File([manual], 'manual-roof.tbx'), 1);
    expect(assets.load.calls.mostRecent().args[0].map(sheet => sheet.name)).toEqual(['manual_roof_01']);
    expect(preview.bounds).toEqual({ left: -32, right: 32, top: -160, bottom: -32 });
    expect(preview.squares).toEqual({ minX: 1, minY: 1, maxX: 1, maxY: 1 });
    expect(preview.warnings).toEqual([]);
    const image = await createImageBitmap(preview.blob);
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      expect([...context.getImageData(32, 64, 1, 1).data]).toEqual([0, 255, 0, 255]);
    } finally { image.close(); }
    expect(JSON.parse(storage.rememberBuildingPreview.calls.mostRecent().args[0])[0]).toBe('building-preview-v6');
  });

  it('replaces generated tiles with manual tiles instead of drawing both', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(255, 0, 0, 0.5)';
    context.fillRect(0, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.callFake(async sheets => ({
      sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), warnings: [], errors: new Map(),
    }));
    const manual = xml.replace('<floor>', '<user_tiles><tile tile="manual_floor_01_0"/></user_tiles><floor>')
      .replace('</floor>', '<tiles layer="Floor">1,0,0,0</tiles></floor>');
    const preview = await service.preview(new File([manual], 'manual-floor.tbx'));
    expect(assets.load.calls.mostRecent().args[0].map(sheet => sheet.name)).toEqual(['manual_floor_01']);
    const image = await createImageBitmap(preview.blob);
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      expect([...context.getImageData(32, 64, 1, 1).data]).toEqual([255, 0, 0, 128]);
    } finally { image.close(); }
  });

  it('reuses a persistent thumbnail without generating geometry or requesting sheets', async () => {
    storage.buildingPreview.and.resolveTo({ blob: new Blob(), width: 1, height: 1, squares: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      bounds: { left: 0, right: 1, top: 0, bottom: 1 }, warnings: [] });
    await service.preview(new File([xml], 'house.tbx'));
    expect(assets.load).not.toHaveBeenCalled();
  });

  it('rebuilds a missing-sheet preview when its hash changes while preserving unrelated previews', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    let floorRevision = 'missing';
    assets.sheetKeys.and.callFake(async names => new Map(names.map(name => [name, name === 'floor_01' ? floorRevision : 'unchanged'])));
    assets.load.and.callFake(async sheets => ({
      sheets: new Map(sheets.filter(sheet => sheet.name !== 'floor_01' || floorRevision !== 'missing').map(sheet => [sheet.firstGid, blob])),
      errors: new Map(sheets.filter(sheet => sheet.name === 'floor_01' && floorRevision === 'missing')
        .map(sheet => [sheet.firstGid, `${sheet.name}: sheet not found in configured tilepacks`])), warnings: [],
    }));
    const partlyMissing = xml.replace('width="1"', 'width="2"')
      .replace('<room Name="Room"', '<tile_entry category="floors"><tile enum="Floor" tile="other_01_000"/></tile_entry><room Name="Other" Floor="2"/><room Name="Room"')
      .replace('<rooms>1</rooms>', '<rooms>1,2</rooms>');
    const floor = new File([partlyMissing], 'floor.tbx'), other = new File([xml.replace('floor_01', 'other_01')], 'other.tbx');
    const before = await service.preview(floor), unrelated = await service.preview(other);
    expect(before.warnings.length).toBeGreaterThan(0);
    floorRevision = 'restored';
    const after = await service.preview(floor);
    expect(after).not.toBe(before);
    expect(after.warnings).toEqual([]);
    expect(await service.preview(other)).toBe(unrelated);
    expect(assets.load).toHaveBeenCalledTimes(2);
    expect(assets.load.calls.mostRecent().args[0].map(sheet => sheet.name)).toEqual(['floor_01']);
  });

  it('retries lots that could not render any tiles when their sheet is restored', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    let restored = false;
    assets.sheetKeys.and.callFake(async names => new Map(names.map(name => [name, restored ? 'restored' : 'missing'])));
    assets.load.and.callFake(async sheets => ({ sheets: new Map(restored ? sheets.map(sheet => [sheet.firstGid, blob]) : []),
      errors: new Map(restored ? [] : sheets.map(sheet => [sheet.firstGid, `${sheet.name}: sheet not found in configured tilepacks`])), warnings: [] }));
    const file = new File([xml], 'floor.tbx'), lots = new BuildingLots(service);
    await lots.load([{ lot: { x: 0, y: 0, width: 1, height: 1, level: 0, map: 'floor.tbx' }, x: 0, y: 0, scale: 1 }],
      new Map([['floor.tbx', file]]), () => undefined);
    expect(lots.loaded).toBe(0);
    restored = true;
    expect(await lots.refresh(new Set(['floor_01']), () => undefined)).toBeTrue();
    expect(lots.loaded).toBe(1); expect(lots.warnings.size).toBe(0);
    lots.dispose();
  });

  it('keeps current lot images visible until affected replacements are ready', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.callFake(async sheets => ({ sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), warnings: [], errors: new Map() }));
    const floor = new File([xml], 'floor.tbx'), other = new File([xml.replace('floor_01', 'other_01')], 'other.tbx');
    const lots = new BuildingLots(service);
    const placements = ['floor', 'other'].map((name, i) => ({ lot: { x: i, y: 0, width: 1, height: 1, level: 0, map: `${name}.tbx` }, x: i, y: 0, scale: 1 }));
    await lots.load(placements, new Map([['floor.tbx', floor], ['other.tbx', other]]), () => undefined);
    const old = lots.sprites[0], unaffected = lots.sprites[1], close = spyOn(old.bitmap, 'close').and.callThrough();
    const preview = await service.preview(floor);
    let release!: (value: typeof preview) => void;
    const render = spyOn(service, 'preview').and.returnValue(new Promise(resolve => { release = resolve; }));
    const refreshing = lots.refresh(new Set(['floor_01']), () => undefined);
    await new Promise(resolve => setTimeout(resolve));
    expect(lots.sprites[0]).toBe(old); expect(close).not.toHaveBeenCalled();
    release(preview); expect(await refreshing).toBeTrue();
    expect(render).toHaveBeenCalledOnceWith(floor, 0, 2048);
    expect(lots.sprites[0]).not.toBe(old); expect(lots.sprites[1]).toBe(unaffected);
    expect(close).toHaveBeenCalledTimes(1);
    lots.dispose();
  });

  it('rejects oversized buildings before generating squares', async () => {
    await expectAsync(service.preview(new File([xml.replace('width="1"', 'width="100000"')], 'huge.tbx')))
      .toBeRejectedWithError(/dimensions/);
    expect(assets.load).not.toHaveBeenCalled();
  });

  it('reports unavailable building files and continues loading other lots', async () => {
    const lots = new BuildingLots(service);
    await lots.load([{ lot: { x: 0, y: 0, width: 1, height: 1, level: 0, map: 'missing.tbx' },
      x: 0, y: 0, scale: 1 }], new Map(), () => undefined);
    expect(lots.loaded).toBe(0);
    expect([...lots.warnings].join(' ')).toContain('missing.tbx');
    lots.dispose();
  });

  it('loads and decodes each shared sheet once while rendering several buildings', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.callFake(async sheets => ({
      sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), warnings: [], errors: new Map(),
    }));
    const decode = spyOn(window, 'createImageBitmap').and.callThrough();
    const previews = await Promise.all(['a', 'b', 'c'].map(name =>
      service.preview(new File([xml.replace('width="1"', `width="1" name="${name}"`)], `${name}.tbx`))));
    expect(previews.every(preview => !preview.warnings.length)).toBeTrue();
    expect(assets.load).toHaveBeenCalledTimes(1);
    expect(decode.calls.all().filter(call => call.args[0] === blob).length).toBe(1);
  });
});

describe('Building lot loading', () => {
  it('requests later previews early but adds sprites in lot order', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const preview = (file: File) => ({ blob, width: 1, height: 1, warnings: [],
      bounds: { left: 0, right: 1, top: 0, bottom: 1 }, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, name: file.name });
    const resolvers: (() => void)[] = [];
    const requested: string[] = [];
    const delayed = { preview: (file: File) => new Promise(resolve => {
      requested.push(file.name);
      resolvers.push(() => resolve(preview(file)));
    }) } as unknown as BuildingPreviewService;
    const immediate = { preview: async (file: File) => preview(file) } as unknown as BuildingPreviewService;
    const files = new Map(['a', 'b', 'c'].map(name => [`${name}.tbx`, new File([xml], `${name}.tbx`)]));
    const placements = [['a', 1, 10], ['b', 0, 20], ['c', 0, 30]].map(([name, level, x]) => ({
      lot: { x: Number(x), y: 0, width: 1, height: 1, level: Number(level), map: `${name}.tbx` }, x: Number(x), y: 0, scale: 1,
    }));
    const expected = new BuildingLots(immediate);
    await expected.load(placements, files, () => undefined);
    const lots = new BuildingLots(delayed);
    const loading = lots.load(placements, files, () => undefined);
    await new Promise(resolve => setTimeout(resolve));
    expect(requested).toEqual(['b.tbx', 'c.tbx', 'a.tbx']);
    resolvers.slice().reverse().forEach(resolve => resolve());
    await loading;
    expect(lots.sprites.map(sprite => [sprite.level, sprite.bounds]))
      .toEqual(expected.sprites.map(sprite => [sprite.level, sprite.bounds]));
    expected.dispose();
    lots.dispose();
  });
});
