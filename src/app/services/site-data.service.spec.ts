import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { DbService } from './db.service';
import { SiteDataService } from './site-data.service';
import { TileService } from './tile.service';
import { TILEZED_STORAGE_DATABASE, TilezedStorageService } from './tilezed-storage.service';
import { WORLDED_STORAGE_DATABASE, WorldedStorageService } from './worlded-storage.service';
import { PROJECT_WORLD_CACHE_DATABASE, ProjectWorldCacheService } from './project-world-cache.service';

describe('SiteDataService', () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const kept = {
    buildingXml: '<building/>',
    [`buildinged:draft:user:project:${suffix}`]: '{"xml":"<building/>","revision":1}',
    [`buildinged:guest:https%3A%2F%2Fapi.example:guest-${suffix}:xml`]: '{"xml":"<building/>","revision":1}',
    'buildinged.roomTileLibrary.v1': '{"entries":[]}',
    selectedLayer: 'Floor',
    [`SiteDataTestPack-${suffix}`]: '1',
  };
  const versionKey = `tilepack-version:SiteDataTestPack-${suffix}`;
  let tiles: Dexie;
  let tileService: { isDownloading: boolean };
  let service: SiteDataService;
  let saved: Record<string, string | null>;

  beforeEach(() => {
    saved = Object.fromEntries([...Object.keys(kept), versionKey].map(key => [key, localStorage.getItem(key)]));
    tiles = new Dexie(`site-data-tiles-${suffix}`);
    tiles.version(1).stores({ tilesets: '&name', sheetImages: '&name' });
    tileService = { isDownloading: false };
    TestBed.configureTestingModule({
      providers: [
        { provide: DbService, useValue: tiles },
        { provide: TileService, useValue: tileService },
        { provide: TILEZED_STORAGE_DATABASE, useValue: `site-data-tilezed-${suffix}` },
        { provide: WORLDED_STORAGE_DATABASE, useValue: `site-data-worlded-${suffix}` },
        { provide: PROJECT_WORLD_CACHE_DATABASE, useValue: `site-data-project-worlds-${suffix}` },
      ],
    });
    service = TestBed.inject(SiteDataService);
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    await Promise.all([tiles.delete(), TestBed.inject(TilezedStorageService).delete(),
      TestBed.inject(WorldedStorageService).delete(), TestBed.inject(ProjectWorldCacheService).delete()]);
  });

  it('clears downloaded tiles and viewer caches but keeps drafts, choices and preferences', async () => {
    const tilezed = TestBed.inject(TilezedStorageService);
    const worlded = TestBed.inject(WorldedStorageService);
    const projectWorlds = TestBed.inject(ProjectWorldCacheService);
    await projectWorlds.table('blobs').put({ scope: 'user', projectId: 'p', hash: 'hash', blob: new Blob(['world']) });
    await tiles.table('tilesets').put({ name: 'walls_01', packName: 'Vanilla' });
    await tiles.table('sheetImages').put({ name: 'walls_01', blob: new Blob(['png']) });
    await tilezed.table('sheets').put({ name: 'walls_01', blob: new Blob(['png']), packName: 'Vanilla', version: '1' });
    await tilezed.table('buildingPreviews').put({ key: 'preview', lastUsed: 1 });
    await tilezed.table('maps').put({ id: 'last' });
    await worlded.table('worlds').put({ id: 'last' });
    Object.entries(kept).forEach(([key, value]) => localStorage.setItem(key, value));
    localStorage.setItem(versionKey, '1');

    await service.clear();

    for (const db of [tiles, tilezed, worlded, projectWorlds]) {
      for (const table of db.tables) expect(await table.count()).withContext(`${db.name}.${table.name}`).toBe(0);
    }
    expect(localStorage.getItem(versionKey)).toBeNull();
    for (const [key, value] of Object.entries(kept)) expect(localStorage.getItem(key)).withContext(key).toBe(value);
  });

  it('refuses to clear while tiles are downloading', async () => {
    await tiles.table('tilesets').put({ name: 'walls_01', packName: 'Vanilla' });
    localStorage.setItem(versionKey, '1');
    tileService.isDownloading = true;

    await expectAsync(service.clear()).toBeRejectedWithError(/tile download/);

    expect(await tiles.table('tilesets').count()).toBe(1);
    expect(localStorage.getItem(versionKey)).toBe('1');
  });
});
