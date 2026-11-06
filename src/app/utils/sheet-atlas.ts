export const TILE_WIDTH = 128;
export const TILE_HEIGHT = 256;

export interface SheetInfo { name: string; columns: number; rows: number; }

export interface SheetSource {
  getSheetInfo(sheet: string): Promise<SheetInfo | undefined>;
  getSheetBlob(sheet: string): Promise<Blob | undefined>;
}

export interface ParsedTileName { sheet: string; index: number; }

/** Splits `sheet_name_012.png` (extension optional) into its sheet name and tile index. */
export function parseTileName(name: string): ParsedTileName | null {
  const match = /^(.+)_(\d+)(?:\.png)?$/i.exec(name ?? '');
  return match ? { sheet: match[1], index: Number(match[2]) } : null;
}

export function tileName(sheet: string, index: number): string {
  return `${sheet}_${index.toString().padStart(3, '0')}.png`;
}

/** Reads width/height from a PNG header without decoding the image. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((value, i) => bytes[i] !== value)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  return width && height ? { width, height } : null;
}

interface DecodedSheet { bitmap: ImageBitmap; bytes: number; }

/** Where a tile sits in its sheet image, for CSS sprite display without cutting or encoding the tile. */
export interface TileSprite { url: string; columns: number; rows: number; column: number; row: number; }

export interface SheetAtlasOptions {
  /** Decoded (RGBA) sheet bytes kept in memory before least-recently-used sheets are dropped. */
  decodedBudgetBytes?: number;
  maxTileUrls?: number;
  idleReleaseMs?: number;
}

/**
 * Tiles are stored as whole sheets; this cuts individual tiles out on demand.
 * Decoded sheets are kept briefly in an LRU so a burst of lookups decodes each sheet once.
 */
export class SheetAtlas {
  private readonly infos = new Map<string, SheetInfo>();
  private readonly decoded = new Map<string, DecodedSheet>();
  private readonly decoding = new Map<string, Promise<ImageBitmap | null>>();
  private readonly tileBitmaps = new Map<string, Promise<ImageBitmap | null>>();
  private readonly tileUrls = new Map<string, string>();
  private readonly tileUrlRequests = new Map<string, Promise<string | null>>();
  private readonly sheetUrls = new Map<string, Promise<string | null>>();
  private decodedBytes = 0;
  private generation = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly budget: number;
  private readonly maxTileUrls: number;
  private readonly idleReleaseMs: number;

  constructor(private readonly source: SheetSource, options: SheetAtlasOptions = {}) {
    this.budget = options.decodedBudgetBytes ?? 256 * 1024 * 1024;
    this.maxTileUrls = options.maxTileUrls ?? 8000;
    this.idleReleaseMs = options.idleReleaseMs ?? 15000;
  }

  async hasTile(name: string): Promise<boolean> {
    return !!(await this.locate(name));
  }

  /** A bitmap of one tile, suitable for canvas drawing. */
  getTileBitmap(name: string): Promise<ImageBitmap | null> {
    let request = this.tileBitmaps.get(name);
    if (!request) {
      const generation = this.generation;
      request = this.cutTile(name).finally(() => {
        if (generation === this.generation) this.tileBitmaps.delete(name);
      });
      this.tileBitmaps.set(name, request);
    }
    return request;
  }

  /** An object URL of one tile, suitable for `<img>`. URLs stay valid until evicted or their sheet changes. */
  getTileUrl(name: string): Promise<string | null> {
    const cached = this.tileUrls.get(name);
    if (cached) {
      this.tileUrls.delete(name);
      this.tileUrls.set(name, cached);
      return Promise.resolve(cached);
    }
    let request = this.tileUrlRequests.get(name);
    if (!request) {
      const generation = this.generation;
      request = this.encodeTile(name).then(blob => {
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        if (generation === this.generation) this.rememberUrl(name, url);
        return url;
      }).finally(() => {
        if (generation === this.generation) this.tileUrlRequests.delete(name);
      });
      this.tileUrlRequests.set(name, request);
    }
    return request;
  }

  /** The tile's position within an object URL of its whole sheet. Much cheaper than `getTileUrl` for many tiles. */
  async getTileSprite(name: string): Promise<TileSprite | null> {
    const location = await this.locate(name);
    if (!location) return null;
    const { name: sheet, columns, rows } = location.info;
    const url = await this.getSheetUrl(sheet);
    return url ? { url, columns, rows, column: location.index % columns, row: Math.floor(location.index / columns) } : null;
  }

  private getSheetUrl(sheet: string): Promise<string | null> {
    let request = this.sheetUrls.get(sheet);
    if (!request) {
      const current: Promise<string | null> = this.source.getSheetBlob(sheet).then(blob => blob ? URL.createObjectURL(blob) : null);
      request = current;
      // Missing sheets aren't remembered: they may still be downloading. `invalidate` revokes the rest.
      const forget = () => { if (this.sheetUrls.get(sheet) === current) this.sheetUrls.delete(sheet); };
      current.then(url => { if (!url) forget(); }, forget);
      this.sheetUrls.set(sheet, current);
    }
    return request;
  }

  async getTileNames(sheet: string): Promise<string[]> {
    const info = await this.getInfo(sheet);
    return info ? Array.from({ length: info.columns * info.rows }, (_, i) => tileName(sheet, i)) : [];
  }

  /** Drops everything cached for the given sheets so the next lookup reads the database again. */
  invalidate(sheets: Iterable<string>): void {
    const names = new Set(sheets);
    if (!names.size) return;
    this.generation++;
    const affected = (tile: string) => names.has(parseTileName(tile)?.sheet ?? '');
    for (const sheet of names) {
      this.infos.delete(sheet);
      this.decoding.delete(sheet);
      this.dropDecoded(sheet);
      const url = this.sheetUrls.get(sheet);
      this.sheetUrls.delete(sheet);
      url?.then(value => { if (value) URL.revokeObjectURL(value); }, () => undefined);
    }
    for (const tile of [...this.tileBitmaps.keys()]) if (affected(tile)) this.tileBitmaps.delete(tile);
    for (const tile of [...this.tileUrlRequests.keys()]) if (affected(tile)) this.tileUrlRequests.delete(tile);
    for (const [tile, url] of [...this.tileUrls]) {
      if (affected(tile)) { this.tileUrls.delete(tile); URL.revokeObjectURL(url); }
    }
  }

  /** Releases decoded sheets (tile URLs stay valid). */
  releaseDecoded(): void {
    for (const sheet of [...this.decoded.keys()]) this.dropDecoded(sheet);
  }

  private async locate(name: string): Promise<{ info: SheetInfo; index: number } | null> {
    const parsed = parseTileName(name);
    if (!parsed) return null;
    const info = await this.getInfo(parsed.sheet);
    return info && parsed.index < info.columns * info.rows ? { info, index: parsed.index } : null;
  }

  private async getInfo(sheet: string): Promise<SheetInfo | undefined> {
    const cached = this.infos.get(sheet);
    if (cached) return cached;
    const generation = this.generation;
    const info = await this.source.getSheetInfo(sheet);
    // Missing sheets aren't remembered: they may still be downloading.
    if (info && generation === this.generation) this.infos.set(sheet, info);
    return info;
  }

  private async cutTile(name: string): Promise<ImageBitmap | null> {
    const location = await this.locate(name);
    if (!location) return null;
    const sheet = await this.decodeSheet(location.info.name);
    if (!sheet) return null;
    const { columns } = location.info;
    const x = (location.index % columns) * TILE_WIDTH, y = Math.floor(location.index / columns) * TILE_HEIGHT;
    return createImageBitmap(sheet, x, y, TILE_WIDTH, TILE_HEIGHT);
  }

  private async encodeTile(name: string): Promise<Blob | null> {
    // A private bitmap: shared ones from getTileBitmap may be held by the canvas and must not be closed here.
    const bitmap = await this.cutTile(name);
    if (!bitmap) return null;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(TILE_WIDTH, TILE_HEIGHT);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        return await canvas.convertToBlob({ type: 'image/png' });
      }
      const canvas = document.createElement('canvas');
      canvas.width = TILE_WIDTH; canvas.height = TILE_HEIGHT;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    } finally {
      bitmap.close();
    }
  }

  private decodeSheet(sheet: string): Promise<ImageBitmap | null> {
    this.scheduleIdleRelease();
    const decoded = this.decoded.get(sheet);
    if (decoded) {
      this.decoded.delete(sheet);
      this.decoded.set(sheet, decoded);
      return Promise.resolve(decoded.bitmap);
    }
    let request = this.decoding.get(sheet);
    if (!request) {
      const generation = this.generation;
      request = (async () => {
        const blob = await this.source.getSheetBlob(sheet);
        if (!blob) return null;
        const bitmap = await createImageBitmap(blob);
        if (generation === this.generation) this.rememberDecoded(sheet, bitmap);
        return bitmap;
      })().finally(() => {
        if (this.decoding.get(sheet) === request) this.decoding.delete(sheet);
      });
      this.decoding.set(sheet, request);
    }
    return request;
  }

  private rememberDecoded(sheet: string, bitmap: ImageBitmap): void {
    const bytes = bitmap.width * bitmap.height * 4;
    this.decoded.set(sheet, { bitmap, bytes });
    this.decodedBytes += bytes;
    for (const oldest of this.decoded.keys()) {
      if (this.decodedBytes <= this.budget || oldest === sheet) break;
      this.dropDecoded(oldest);
    }
  }

  private dropDecoded(sheet: string): void {
    const decoded = this.decoded.get(sheet);
    if (!decoded) return;
    this.decoded.delete(sheet);
    this.decodedBytes -= decoded.bytes;
    // Tiles may still be being cut from this sheet; free its memory once they are done.
    setTimeout(() => decoded.bitmap.close(), 2000);
  }

  private rememberUrl(name: string, url: string): void {
    this.tileUrls.set(name, url);
    while (this.tileUrls.size > this.maxTileUrls) {
      const [oldest, oldUrl] = this.tileUrls.entries().next().value as [string, string];
      this.tileUrls.delete(oldest);
      URL.revokeObjectURL(oldUrl);
    }
  }

  private scheduleIdleRelease(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.idleTimer = undefined; this.releaseDecoded(); }, this.idleReleaseMs);
  }
}
