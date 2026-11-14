import { HttpEventType } from '@angular/common/http';
import { Subject } from 'rxjs';
import { Tilepack } from '../models/app.models';
import { TileService } from './tile.service';

describe('TileService download queue', () => {
  const names = ['QueueA', 'QueueB', 'QueueZip', 'QueueVersioned'];
  let requests: Map<string, Subject<unknown>>;
  let db: jasmine.SpyObj<any>;
  let service: TileService;

  const clearStorage = () => names.forEach(name => { localStorage.removeItem(name); localStorage.removeItem(`tilepack-version:${name}`); });
  const settle = () => new Promise(resolve => setTimeout(resolve));
  const pack = (name: string, url: string, version?: string): Tilepack => ({ name, url, enabled: true, version });
  const respond = (url: string, body: unknown) => { const request = requests.get(url)!; request.next(body); request.complete(); };

  beforeEach(() => {
    clearStorage();
    requests = new Map();
    const http = { get: (url: string) => { const subject = new Subject<unknown>(); requests.set(url, subject); return subject; } };
    db = jasmine.createSpyObj('DbService', ['clearTiles', 'hasPackTilesets', 'hasTileset', 'existingTilesets', 'putSheets']);
    db.existingTilesets.and.resolveTo(new Set());
    db.putSheets.and.resolveTo();
    db.clearTiles.and.resolveTo();
    db.hasPackTilesets.and.resolveTo(true);
    service = new TileService(db, http as any);
  });

  afterEach(clearStorage);

  it('never requests or clears an admin-disabled pack, including forced downloads and version changes', async () => {
    localStorage.setItem('QueueA', '1');
    localStorage.setItem('tilepack-version:QueueA', '1');
    const disabled = { ...pack('QueueA', 'disabled.zip', '2'), disabled: true, required: true };
    await service.processTilepacks([disabled]);
    await service.redownloadTilepack(disabled);
    expect(requests.size).toBe(0);
    expect(db.clearTiles).not.toHaveBeenCalled();
    expect(localStorage.getItem('QueueA')).toBe('1');
    expect(localStorage.getItem('tilepack-version:QueueA')).toBe('1');
  });

  it('downloads required packs despite a saved off setting and leaves optional packs off even in first position', async () => {
    localStorage.setItem('QueueB', '0');
    const done = service.processTilepacks([
      { ...pack('QueueA', 'optional.json'), enabled: false },
      { ...pack('QueueB', 'required.json'), enabled: false, required: true },
    ]);
    await settle();
    expect(requests.has('optional.json')).toBeFalse();
    expect(requests.has('required.json')).toBeTrue();
    respond('required.json', []);
    await done;
  });

  it('downloads Vanilla regardless of its position or saved setting', async () => {
    const done = service.processTilepacks([
      { ...pack('QueueA', 'optional.json'), enabled: false },
      { name: 'Vanilla', url: 'vanilla.json', enabled: false },
    ]);
    await settle();
    expect(requests.has('vanilla.json')).toBeTrue();
    respond('vanilla.json', []);
    await done;
  });

  it('queues a redownload requested during another download instead of dropping it', async () => {
    const first = service.processTilepacks([pack('QueueA', 'a.json')], 0);
    await settle();
    expect(service.isDownloading).toBeTrue();

    const second = service.redownloadTilepack(pack('QueueB', 'b.json'));
    await settle();
    expect(requests.has('b.json')).toBeFalse();

    respond('a.json', []);
    await settle();
    expect(db.clearTiles).toHaveBeenCalledWith('QueueB');
    respond('b.json', []);
    await Promise.all([first, second]);

    expect(service.isDownloading).toBeFalse();
    expect(localStorage.getItem('tilepack-version:QueueB')).toBe('unversioned');
  });

  it('skips re-downloading a fully cached zip pack', async () => {
    localStorage.setItem('tilepack-version:QueueZip', 'unversioned');
    await service.processTilepacks([pack('QueueZip', 'pack.zip')], 0);
    expect(requests.size).toBe(0);

    db.hasPackTilesets.and.resolveTo(false);
    const pending = service.processTilepacks([pack('QueueZip', 'pack.zip')], 0);
    for (let i = 0; i < 50 && !requests.has('pack.zip'); i++) await settle();
    expect(requests.has('pack.zip')).toBeTrue();
    requests.get('pack.zip')!.error(new Error('offline'));
    await pending;
    expect(service.isDownloading).toBeFalse();
  });

  it('clears cached sheets when a pack is republished', async () => {
    localStorage.setItem('tilepack-version:QueueVersioned', '1');
    const done = service.processTilepacks([pack('QueueVersioned', 'v.json', '2')], 0);
    await settle();
    expect(db.clearTiles).toHaveBeenCalledWith('QueueVersioned');
    respond('v.json', []);
    await done;
    expect(localStorage.getItem('tilepack-version:QueueVersioned')).toBe('2');
  });
  const png = async (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  };

  it('stores whole zip sheets from Tiles/2x and its subfolders without splitting them', async () => {
    const jszip: any = await import('jszip');
    const zip = new (jszip.default ?? jszip)();
    zip.file('Tiles/2x/walls_01.png', await png(256, 512));
    zip.file('Tiles/2x/Main.pack/floors_01.png', await png(1024, 256));
    zip.file('Tiles/2x/Other.pack/walls_01.png', await png(128, 256));
    zip.file('Tiles/2x/Main.pack/cached_01.png', await png(128, 256));
    zip.file('Tiles/1x/ignored_01.png', await png(128, 256));
    zip.file('Tiles/2x/notes.txt', 'x');
    zip.file('Tiles/2x/blood_small.png', await png(512, 128));
    const body = await zip.generateAsync({ type: 'arraybuffer' });
    db.existingTilesets.and.callFake(async (names: string[]) => new Set(names.filter(name => name === 'cached_01')));

    const done = service.processTilepacks([pack('QueueZip', 'pack.zip')], 0);
    for (let i = 0; i < 50 && !requests.has('pack.zip'); i++) await settle();
    requests.get('pack.zip')!.next({ type: HttpEventType.Response, body });
    requests.get('pack.zip')!.complete();
    await done;

    const stored = db.putSheets.calls.allArgs().flatMap(([sheets]: any[]) => sheets);
    expect(stored.map((sheet: any) => sheet.tileset)).toEqual([
      { name: 'floors_01', packName: 'QueueZip', columns: 8, rows: 1, url: 'Tiles/2x/Main.pack/floors_01.png' },
      // Duplicate names: the first path in sorted order wins.
      { name: 'walls_01', packName: 'QueueZip', columns: 1, rows: 1, url: 'Tiles/2x/Other.pack/walls_01.png' },
    ]);
    expect(stored.every((sheet: any) => sheet.blob instanceof Blob && sheet.blob.type === 'image/png')).toBeTrue();
    expect(service.failedDecodes).toEqual([]);
    expect(localStorage.getItem('tilepack-version:QueueZip')).toBe('unversioned');
  });
});
