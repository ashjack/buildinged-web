import { parseTileName, readPngSize, SheetAtlas, SheetInfo, tileName } from './sheet-atlas';

describe('SheetAtlas', () => {
  const sheetPng = async (columns: number, rows: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = columns * 128; canvas.height = rows * 256;
    const context = canvas.getContext('2d')!;
    // Each tile gets a distinct red value so cut tiles can be identified.
    for (let i = 0; i < columns * rows; i++) {
      context.fillStyle = `rgb(${i * 10}, 0, 0)`;
      context.fillRect((i % columns) * 128, Math.floor(i / columns) * 256, 128, 256);
    }
    return new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  };
  const red = (bitmap: ImageBitmap) => {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(64, 128, 1, 1).data[0];
  };

  let infos: Map<string, SheetInfo>, blobs: Map<string, Blob>, blobReads: number, atlas: SheetAtlas;
  beforeEach(async () => {
    infos = new Map([['walls_01', { name: 'walls_01', columns: 2, rows: 2 }]]);
    blobs = new Map([['walls_01', await sheetPng(2, 2)]]);
    blobReads = 0;
    atlas = new SheetAtlas({
      getSheetInfo: async name => infos.get(name),
      getSheetBlob: async name => { blobReads++; return blobs.get(name); },
    });
  });
  afterEach(() => atlas.releaseDecoded());

  it('parses tile names and builds padded ones', () => {
    expect(parseTileName('walls_exterior_house_01_012.png')).toEqual({ sheet: 'walls_exterior_house_01', index: 12 });
    expect(parseTileName('fixtures_01_7')).toEqual({ sheet: 'fixtures_01', index: 7 });
    expect(parseTileName('no-index.png')).toBeNull();
    expect(tileName('floors_01', 3)).toBe('floors_01_003.png');
  });

  it('reads PNG dimensions from the header', async () => {
    expect(readPngSize(new Uint8Array(await (await sheetPng(3, 2)).arrayBuffer()))).toEqual({ width: 384, height: 512 });
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('cuts tiles from the sheet, decoding it once for a burst of lookups', async () => {
    expect(await atlas.hasTile('walls_01_003.png')).toBeTrue();
    expect(await atlas.hasTile('walls_01_004.png')).toBeFalse();
    expect(await atlas.hasTile('missing_01_000.png')).toBeFalse();
    const bitmaps = await Promise.all([0, 1, 2, 3].map(i => atlas.getTileBitmap(tileName('walls_01', i))));
    expect(bitmaps.map(bitmap => [bitmap!.width, bitmap!.height])).toEqual([[128, 256], [128, 256], [128, 256], [128, 256]]);
    expect(bitmaps.map(bitmap => red(bitmap!))).toEqual([0, 10, 20, 30]);
    expect(blobReads).toBe(1);
    expect(await atlas.getTileNames('walls_01')).toEqual(['walls_01_000.png', 'walls_01_001.png', 'walls_01_002.png', 'walls_01_003.png']);
  });

  it('caches thumbnail URLs until the sheet changes', async () => {
    const first = await atlas.getTileUrl('walls_01_001.png');
    expect(first).toMatch(/^blob:/);
    expect(await atlas.getTileUrl('walls_01_001.png')).toBe(first);

    blobs.set('walls_01', await sheetPng(1, 1));
    infos.set('walls_01', { name: 'walls_01', columns: 1, rows: 1 });
    atlas.invalidate(['walls_01']);
    expect(await atlas.getTileUrl('walls_01_001.png')).toBeNull();
    expect(await atlas.getTileUrl('walls_01_000.png')).toMatch(/^blob:/);
  });

  it('locates tiles as sprites sharing one URL per sheet', async () => {
    const sprites = await Promise.all([0, 3].map(i => atlas.getTileSprite(tileName('walls_01', i))));
    expect(sprites[0]!.url).toMatch(/^blob:/);
    expect(sprites[1]!.url).toBe(sprites[0]!.url);
    expect(sprites.map(sprite => [sprite!.columns, sprite!.rows, sprite!.column, sprite!.row])).toEqual([[2, 2, 0, 0], [2, 2, 1, 1]]);
    expect(blobReads).toBe(1);
    expect(await atlas.getTileSprite('walls_01_004.png')).toBeNull();
    expect(await atlas.getTileSprite('missing_01_000.png')).toBeNull();

    atlas.invalidate(['walls_01']);
    expect((await atlas.getTileSprite('walls_01_001.png'))!.url).not.toBe(sprites[0]!.url);
    expect(blobReads).toBe(2);
  });

  it('finds sheets that are stored after a failed lookup', async () => {
    expect(await atlas.hasTile('late_01_000.png')).toBeFalse();
    infos.set('late_01', { name: 'late_01', columns: 1, rows: 1 });
    blobs.set('late_01', await sheetPng(1, 1));
    expect(await atlas.hasTile('late_01_000.png')).toBeTrue();
  });
});
