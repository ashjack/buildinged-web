import { Injectable, OnDestroy } from '@angular/core';
import { Building } from '../models/app.models';
import { BuildingPreview, BuildingSquares, PreviewTile } from '../utils/building-preview';
import { readPngSize } from '../utils/sheet-atlas';
import { readBuildingPreviewFile } from '../utils/tbx-format';
import { TilezedTileset } from '../utils/tilezed-map';
import { TilezedBounds } from '../utils/tilezed-renderer';
import { TilezedAssets, TilezedAssetsService } from './tilezed-assets.service';
import { TilezedStorageService } from './tilezed-storage.service';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BUILDING_CELLS = 65536;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_PREVIEW_SIDE = 2048;
const CEILING_WARNING = 'Room ceiling tiles are not included in building previews.';
const MISSING_SHEET_SUFFIX = 'sheet not found in configured tilepacks';
const MAX_JOBS = 3;
const DECODED_IDLE_MS = 10000;

interface PreparedBuilding { tiles: PreviewTile[]; bounds: TilezedBounds; squares: BuildingSquares; }
interface DecodedSheet { bitmap: ImageBitmap; bytes: number; }
interface SheetLoad { blob?: Blob; error?: string; warnings: string[]; }
interface PreviewWorker {
  worker: Worker;
  jobs: Map<number, { resolve: (value: PreparedBuilding) => void; reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout> }>;
}

@Injectable({ providedIn: 'root' })
export class BuildingPreviewService implements OnDestroy {
  private readonly cache = new Map<File, Map<string, BuildingPreview>>();
  private cacheBytes = 0;
  private readonly pending = new Map<File, Map<string, Promise<BuildingPreview>>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private worker?: PreviewWorker;
  private workerIdle?: ReturnType<typeof setTimeout>;
  private workerJobId = 0;
  private readonly missingSheets = new Map<string, { configuration: string; expires: number; error: string }>();
  private configuration = '';
  // Decoded sheets are shared between buildings so common roof/wall sheets are decoded once per load.
  private readonly decoded = new Map<string, DecodedSheet>();
  private readonly decoding = new Map<string, Promise<DecodedSheet>>();
  private readonly pins = new Map<string, number>();
  private readonly sheetLoads = new Map<string, Promise<SheetLoad>>();
  private decodedBytes = 0;
  private decodedIdle?: ReturnType<typeof setTimeout>;

  constructor(private readonly assets: TilezedAssetsService, private readonly storage: TilezedStorageService) { }

  ngOnDestroy(): void {
    if (this.workerIdle) clearTimeout(this.workerIdle);
    if (this.worker) this.stopWorker(this.worker, 'The building preview service was destroyed.');
    if (this.decodedIdle) clearTimeout(this.decodedIdle);
    this.trimDecoded(0);
  }

  /** `maxWidth` limits the stored image width, like WorldEd's fixed-width lot thumbnails. */
  preview(file: File, firstLevel = 0, maxWidth = MAX_PREVIEW_SIDE): Promise<BuildingPreview> {
    const variant = `${firstLevel}:${maxWidth}`;
    const inFlight = this.pending.get(file)?.get(variant);
    if (inFlight) return inFlight;
    const job = this.run(async () => {
      const configuration = await this.assets.configurationKey();
      if (this.configuration !== configuration) {
        this.cache.clear();
        this.cacheBytes = 0;
        this.missingSheets.clear();
        this.configuration = configuration;
        this.trimDecoded(0);
        this.sheetLoads.clear();
      }
      const existing = this.cache.get(file)?.get(variant);
      if (existing) {
        const variants = this.cache.get(file)!;
        this.cache.delete(file);
        this.cache.set(file, variants);
        return existing;
      }
      const preview = await this.createPreview(file, firstLevel, maxWidth);
      const variants = this.cache.get(file) ?? new Map<string, BuildingPreview>();
      variants.set(variant, preview);
      this.cache.delete(file);
      this.cache.set(file, variants);
      this.cacheBytes += preview.blob.size;
      while (this.cacheBytes > MAX_CACHE_BYTES && this.cache.size) {
        const oldest = this.cache.keys().next().value as File;
        for (const value of this.cache.get(oldest)!.values()) this.cacheBytes -= value.blob.size;
        this.cache.delete(oldest);
      }
      return preview;
    });
    const variants = this.pending.get(file) ?? new Map<string, Promise<BuildingPreview>>();
    variants.set(variant, job);
    this.pending.set(file, variants);
    const forget = () => {
      if (variants.get(variant) !== job) return;
      variants.delete(variant);
      if (!variants.size) this.pending.delete(file);
    };
    job.then(forget, forget);
    return job;
  }

  /** Runs a few previews at once so worker, storage, network and PNG encoding overlap. */
  private async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.decodedIdle) clearTimeout(this.decodedIdle);
    this.decodedIdle = undefined;
    if (this.active < MAX_JOBS) this.active++;
    else await new Promise<void>(resolve => this.waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else if (!--this.active && (this.decoded.size || this.sheetLoads.size)) {
        this.decodedIdle = setTimeout(() => {
          this.decodedIdle = undefined;
          if (this.active) return;
          this.trimDecoded(0);
          this.sheetLoads.clear();
        }, DECODED_IDLE_MS);
      }
    }
  }

  /** Shares sheet lookups between overlapping previews so each sheet is fetched once per load. */
  private async loadSheets(sheets: readonly TilezedTileset[], configuration: string): Promise<TilezedAssets> {
    const keyOf = (name: string) => `${configuration}\n${name}`;
    const fresh = sheets.filter(sheet => !this.sheetLoads.has(keyOf(sheet.name)));
    if (fresh.length) {
      const batch = this.assets.load(fresh);
      for (const sheet of fresh) {
        const key = keyOf(sheet.name);
        const result: Promise<SheetLoad> = batch.then(
          value => ({ blob: value.sheets.get(sheet.firstGid), error: value.errors.get(sheet.firstGid), warnings: value.warnings }),
          error => ({ error: `${sheet.name}: ${error instanceof Error ? error.message : String(error)}`, warnings: [] }));
        this.sheetLoads.set(key, result);
        // Transient failures are retried by the next building; missing sheets stay memoised.
        void result.then(value => {
          if (!value.blob && !value.error?.endsWith(MISSING_SHEET_SUFFIX) && this.sheetLoads.get(key) === result) {
            this.sheetLoads.delete(key);
          }
        });
      }
    }
    const loaded = await Promise.all(sheets.map(sheet => this.sheetLoads.get(keyOf(sheet.name))!));
    const result: TilezedAssets = { sheets: new Map(), errors: new Map(), warnings: [] };
    const warnings = new Set<string>();
    sheets.forEach((sheet, index) => {
      const value = loaded[index];
      if (value.blob) result.sheets.set(sheet.firstGid, value.blob);
      if (value.error) result.errors.set(sheet.firstGid, value.error);
      value.warnings.forEach(warning => warnings.add(warning));
    });
    result.warnings = [...warnings];
    return result;
  }

  private trimDecoded(limit: number): void {
    for (const [key, sheet] of this.decoded) {
      if (this.decodedBytes <= limit) break;
      if (this.pins.has(key)) continue;
      sheet.bitmap.close();
      this.decodedBytes -= sheet.bytes;
      this.decoded.delete(key);
    }
  }

  private decodeSheet(key: string, source: { blob: Blob; height: number; bytes: number }): Promise<DecodedSheet> {
    const existing = this.decoded.get(key);
    if (existing) return Promise.resolve(existing);
    let decoding = this.decoding.get(key);
    if (!decoding) {
      decoding = (async () => {
        // Sheets used by running previews stay pinned; an oversized set is trimmed once they finish.
        this.trimDecoded(MAX_CACHE_BYTES - source.bytes);
        const bitmap = await createImageBitmap(source.blob, {
          resizeWidth: 512, resizeHeight: source.height, resizeQuality: 'pixelated',
        });
        const sheet = { bitmap, bytes: source.bytes };
        this.decoded.set(key, sheet);
        this.decodedBytes += sheet.bytes;
        return sheet;
      })();
      this.decoding.set(key, decoding);
      const forget = () => this.decoding.delete(key);
      decoding.then(forget, forget);
    }
    return decoding;
  }

  private async prepare(building: Building, firstLevel: number): Promise<PreparedBuilding> {
    if (typeof Worker === 'undefined') throw new Error('This browser cannot render buildings in a background worker.');
    if (this.workerIdle) clearTimeout(this.workerIdle);
    this.workerIdle = undefined;
    const current = this.worker ??= this.startWorker();
    const id = ++this.workerJobId;
    try {
      return await new Promise<PreparedBuilding>((resolve, reject) => {
        const timeout = setTimeout(() => this.stopWorker(current, 'Building generation exceeded 30 seconds.'), 30000);
        current.jobs.set(id, { resolve, reject, timeout });
        current.worker.postMessage({ id, building, firstLevel });
      });
    } finally {
      if (this.worker === current && !current.jobs.size) {
        if (this.workerIdle) clearTimeout(this.workerIdle);
        this.workerIdle = setTimeout(() => {
          if (this.worker === current && !current.jobs.size) this.stopWorker(current, 'The building worker stopped.');
        }, 5000);
      }
    }
  }

  private startWorker(): PreviewWorker {
    const current: PreviewWorker = {
      worker: new Worker(new URL('../utils/building-preview.worker', import.meta.url)),
      jobs: new Map(),
    };
    current.worker.onmessage = ({ data }: MessageEvent<PreparedBuilding & { id: number; error?: string }>) => {
      const job = current.jobs.get(data.id);
      if (!job) return;
      current.jobs.delete(data.id);
      clearTimeout(job.timeout);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    };
    current.worker.onerror = event => this.stopWorker(current, `Building worker failed: ${event.message}`);
    return current;
  }

  private stopWorker(current: PreviewWorker, message: string): void {
    current.worker.terminate();
    if (this.worker === current) this.worker = undefined;
    for (const job of current.jobs.values()) {
      clearTimeout(job.timeout);
      job.reject(new Error(message));
    }
    current.jobs.clear();
  }

  private async createPreview(file: File, firstLevel: number, maxWidth: number): Promise<BuildingPreview> {
    if (!Number.isSafeInteger(maxWidth) || maxWidth < 1 || maxWidth > MAX_PREVIEW_SIDE) {
      throw new Error('Invalid building preview width.');
    }
    if (!/\.tbx$/i.test(file.name)) throw new Error('Only TBX building lots are currently supported.');
    if (file.size > MAX_FILE_BYTES) throw new Error('Building files larger than 4 MiB are not supported.');
    const bytes = await file.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const cacheKey = JSON.stringify(['building-preview-v5', hash, firstLevel, maxWidth, this.configuration]);
    const cacheWarnings: string[] = [];
    try {
      const cached = await this.storage.buildingPreview(cacheKey);
      if (cached) return cached;
    } catch (error) {
      cacheWarnings.push(`Could not read the building preview cache: ${error instanceof Error ? error.message : String(error)}`);
    }
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
    const root = xml.documentElement;
    const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
    const floors = Array.from(root.children).filter(child => child.tagName === 'floor').length;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
        width > 512 || height > 512 || !floors || floors > 32 || width * height * floors > MAX_BUILDING_CELLS) {
      throw new Error('Building dimensions exceed the supported preview limits.');
    }
    const building = readBuildingPreviewFile(xml);
    const prepared = await this.prepare(building, firstLevel);
    const maxIndices = new Map<string, number>();
    for (const tile of prepared.tiles) maxIndices.set(tile.sheet, Math.max(maxIndices.get(tile.sheet) ?? 0, tile.index));
    const sheets: TilezedTileset[] = [...maxIndices].map(([name, index], i) => ({
      name, source: `${name}.png`, firstGid: i + 1, tileWidth: 64, tileHeight: 128,
      columns: 8, rows: Math.ceil((index + 1) / 8), imageWidth: 512, imageHeight: Math.ceil((index + 1) / 8) * 128,
    }));
    const configuration = this.configuration;
    const keyOf = (name: string) => `${configuration}\n${name}`;
    const pinned = [...new Set(sheets.map(sheet => keyOf(sheet.name)))];
    pinned.forEach(key => this.pins.set(key, (this.pins.get(key) ?? 0) + 1));
    try {
      const skipped = new Map<number, string>();
      const requested = sheets.filter(sheet => {
        if (this.decoded.has(keyOf(sheet.name))) return false;
        const missing = this.missingSheets.get(sheet.name);
        if (missing && missing.configuration === configuration && missing.expires > Date.now()) {
          skipped.set(sheet.firstGid, missing.error);
          return false;
        }
        return true;
      });
      const resolved = requested.length ? await this.loadSheets(requested, configuration) :
        { sheets: new Map<number, Blob>(), errors: new Map<number, string>(), warnings: [] };
      for (const [gid, error] of skipped) resolved.errors.set(gid, error);
      for (const sheet of requested) {
        const error = resolved.errors.get(sheet.firstGid);
        if (error?.endsWith(MISSING_SHEET_SUFFIX)) {
          this.missingSheets.set(sheet.name, { configuration, expires: Date.now() + 600000, error });
        }
      }
      const warnings = [...resolved.warnings, ...cacheWarnings];
      if (Number(root.getAttribute('version')) >= 4) warnings.push(CEILING_WARNING);
      const sourceWidth = prepared.bounds.right - prepared.bounds.left;
      const sourceHeight = prepared.bounds.bottom - prepared.bounds.top;
      const scale = Math.min(1, MAX_PREVIEW_SIDE / sourceWidth, MAX_PREVIEW_SIDE / sourceHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(sourceWidth * scale);
      canvas.height = Math.ceil(sourceHeight * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the building preview canvas.');
      context.imageSmoothingEnabled = false;
      context.setTransform(scale, 0, 0, scale, -prepared.bounds.left * scale, -prepared.bounds.top * scale);
      const sources = new Map<string, { blob: Blob; height: number; bytes: number }>();
      for (const sheet of sheets) {
        if (this.decoded.has(keyOf(sheet.name))) continue;
        const blob = resolved.sheets.get(sheet.firstGid);
        if (!blob) {
          warnings.push(resolved.errors.get(sheet.firstGid) ?? `Building sheet unavailable: ${sheet.name}`);
          continue;
        }
        try {
          const size = readPngSize(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
          if (!size || ![512, 1024].includes(size.width)) {
            throw new Error('Unsupported building sheet dimensions.');
          }
          const sourceScale = size.width / 512;
          const bytes = 512 * size.height / sourceScale * 4;
          if (bytes > MAX_CACHE_BYTES) throw new Error('A building sheet exceeds the 96 MiB memory limit.');
          sources.set(sheet.name, { blob, height: size.height / sourceScale, bytes });
        } catch (error) {
          warnings.push(`${sheet.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!sources.size && !sheets.some(sheet => this.decoded.has(keyOf(sheet.name)))) {
        throw new Error(`No building tiles could be loaded. ${warnings.slice(0, 3).join('; ')}`);
      }
      for (let i = 0; i < prepared.tiles.length; i++) {
        const tile = prepared.tiles[i], source = sources.get(tile.sheet), key = keyOf(tile.sheet);
        let sheet = this.decoded.get(key);
        if (source && !sheet) {
          try {
            sheet = await this.decodeSheet(key, source);
          } catch (error) {
            warnings.push(`${tile.sheet}: ${error instanceof Error ? error.message : String(error)}`);
            sources.delete(tile.sheet);
          }
        }
        if (sheet) {
          this.decoded.delete(key);
          this.decoded.set(key, sheet);
          const tw = 64, th = 128;
          if ((Math.floor(tile.index / 8) + 1) * th <= sheet.bitmap.height) {
            context.drawImage(sheet.bitmap, tile.index % 8 * tw, Math.floor(tile.index / 8) * th,
              tw, th, tile.x, tile.y, 64, 128);
          } else warnings.push(`${tile.sheet} does not contain tile ${tile.index}.`);
        }
        if (i % 512 === 511) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      let output = canvas;
      if (canvas.width > maxWidth) {
        output = document.createElement('canvas');
        output.width = maxWidth;
        output.height = Math.max(1, Math.round(canvas.height * maxWidth / canvas.width));
        const thumbnail = output.getContext('2d');
        if (!thumbnail) throw new Error('Could not create the building thumbnail canvas.');
        thumbnail.imageSmoothingQuality = 'high';
        thumbnail.drawImage(canvas, 0, 0, output.width, output.height);
        canvas.width = canvas.height = 0;
      }
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(
        value => value ? resolve(value) : reject(new Error('Could not encode the building preview.')), 'image/png'));
      const preview = { blob, bounds: prepared.bounds, squares: prepared.squares,
        width: output.width, height: output.height, warnings: [...new Set(warnings)] };
      // Like WorldEd's lot thumbnails, keep images whose gaps are fixed for this tile configuration.
      if (preview.warnings.every(warning => warning === CEILING_WARNING ||
          warning.endsWith(MISSING_SHEET_SUFFIX))) {
        try { await this.storage.rememberBuildingPreview(cacheKey, preview); }
        catch (error) { preview.warnings.push(`Could not cache the building preview: ${error instanceof Error ? error.message : String(error)}`); }
      }
      return preview;
    } finally {
      for (const key of pinned) {
        const count = this.pins.get(key)! - 1;
        if (count) this.pins.set(key, count);
        else this.pins.delete(key);
      }
      this.trimDecoded(MAX_CACHE_BYTES);
    }
  }
}
