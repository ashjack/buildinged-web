import { Injectable, OnDestroy } from '@angular/core';
import { Building } from '../models/app.models';
import { BuildingPreview, BuildingSquares, PreviewTile } from '../utils/building-preview';
import { readPngSize } from '../utils/sheet-atlas';
import { readBuildingPreviewFile } from '../utils/tbx-format';
import { TilezedTileset } from '../utils/tilezed-map';
import { TilezedBounds } from '../utils/tilezed-renderer';
import { TilezedAssetsService } from './tilezed-assets.service';
import { TilezedStorageService } from './tilezed-storage.service';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BUILDING_CELLS = 65536;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_PREVIEW_SIDE = 2048;
const CEILING_WARNING = 'Room ceiling tiles are not included in building previews.';
const MISSING_SHEET_SUFFIX = 'sheet not found in configured tilepacks';

interface PreparedBuilding { tiles: PreviewTile[]; bounds: TilezedBounds; squares: BuildingSquares; }

@Injectable({ providedIn: 'root' })
export class BuildingPreviewService implements OnDestroy {
  private readonly cache = new Map<File, Map<string, BuildingPreview>>();
  private cacheBytes = 0;
  private jobs: Promise<void> = Promise.resolve();
  private worker?: Worker;
  private workerIdle?: ReturnType<typeof setTimeout>;
  private readonly missingSheets = new Map<string, { configuration: string; expires: number; error: string }>();
  private configuration = '';

  constructor(private readonly assets: TilezedAssetsService, private readonly storage: TilezedStorageService) { }

  ngOnDestroy(): void {
    if (this.workerIdle) clearTimeout(this.workerIdle);
    this.worker?.terminate();
    this.worker = undefined;
  }

  /** `maxWidth` limits the stored image width, like WorldEd's fixed-width lot thumbnails. */
  preview(file: File, firstLevel = 0, maxWidth = MAX_PREVIEW_SIDE): Promise<BuildingPreview> {
    const variant = `${firstLevel}:${maxWidth}`;
    const job = this.jobs.then(async () => {
      const configuration = this.assets.configurationKey();
      if (this.configuration !== configuration) {
        this.cache.clear();
        this.cacheBytes = 0;
        this.missingSheets.clear();
        this.configuration = configuration;
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
    this.jobs = job.then(() => undefined, () => undefined);
    return job;
  }

  private async prepare(building: Building, firstLevel: number): Promise<PreparedBuilding> {
    if (typeof Worker === 'undefined') throw new Error('This browser cannot render buildings in a background worker.');
    if (this.workerIdle) clearTimeout(this.workerIdle);
    const worker = this.worker ??= new Worker(new URL('../utils/building-preview.worker', import.meta.url));
    try {
      return await new Promise<PreparedBuilding>((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          this.worker = undefined;
          reject(new Error('Building generation exceeded 30 seconds.'));
        }, 30000);
        worker.onmessage = ({ data }: MessageEvent<PreparedBuilding & { error?: string }>) => {
          clearTimeout(timeout);
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        };
        worker.onerror = event => {
          clearTimeout(timeout);
          worker.terminate();
          this.worker = undefined;
          reject(new Error(`Building worker failed: ${event.message}`));
        };
        worker.postMessage({ building, firstLevel });
      });
    } finally {
      this.workerIdle = setTimeout(() => {
        if (this.worker === worker) {
          worker.terminate();
          this.worker = undefined;
        }
      }, 5000);
    }
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
    const skipped = new Map<number, string>();
    const requested = sheets.filter(sheet => {
      const missing = this.missingSheets.get(sheet.name);
      if (missing && missing.configuration === this.configuration && missing.expires > Date.now()) {
        skipped.set(sheet.firstGid, missing.error);
        return false;
      }
      return true;
    });
    const resolved = requested.length ? await this.assets.load(requested) :
      { sheets: new Map<number, Blob>(), errors: new Map<number, string>(), warnings: [] };
    for (const [gid, error] of skipped) resolved.errors.set(gid, error);
    for (const sheet of requested) {
      const error = resolved.errors.get(sheet.firstGid);
      if (error?.endsWith(MISSING_SHEET_SUFFIX)) {
        this.missingSheets.set(sheet.name, { configuration: this.configuration, expires: Date.now() + 600000, error });
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
    const decoded = new Map<string, { bitmap: ImageBitmap; bytes: number }>();
    let decodedBytes = 0;
    try {
      for (const sheet of sheets) {
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
      if (!sources.size) throw new Error(`No building tiles could be loaded. ${warnings.slice(0, 3).join('; ')}`);
      for (let i = 0; i < prepared.tiles.length; i++) {
        const tile = prepared.tiles[i], source = sources.get(tile.sheet);
        let sheet = decoded.get(tile.sheet);
        if (source && !sheet) {
          try {
            while (decodedBytes + source.bytes > MAX_CACHE_BYTES && decoded.size) {
              const oldest = decoded.keys().next().value as string;
              const image = decoded.get(oldest)!;
              image.bitmap.close();
              decodedBytes -= image.bytes;
              decoded.delete(oldest);
            }
            const bitmap = await createImageBitmap(source.blob, {
              resizeWidth: 512, resizeHeight: source.height, resizeQuality: 'pixelated',
            });
            sheet = { bitmap, bytes: source.bytes };
            decodedBytes += source.bytes;
            decoded.set(tile.sheet, sheet);
          } catch (error) {
            warnings.push(`${tile.sheet}: ${error instanceof Error ? error.message : String(error)}`);
            sources.delete(tile.sheet);
          }
        }
        if (sheet) {
          decoded.delete(tile.sheet);
          decoded.set(tile.sheet, sheet);
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
      decoded.forEach(sheet => sheet.bitmap.close());
    }
  }
}
