import { Injectable } from "@angular/core";
import { DbService, Tileset } from "./db.service";
import { HttpClient, HttpEventType, HttpHeaders } from "@angular/common/http";
import { Tilepack } from "../models/app.models";
import { BehaviorSubject, firstValueFrom } from "rxjs";
import { JSZipObject } from "jszip";
import { readPngSize, TILE_HEIGHT, TILE_WIDTH } from "../utils/sheet-atlas";
import { isTilepackRequired, isTilepackSelected } from '../utils/tilepack-manifest';

export interface TileDownloadProgress {
  active: boolean;
  totalTiles: number;
  processedTiles: number;
  currentPackName?: string;
  currentSheetName?: string;
  detail?: string;
  failedSheets: number;
}

interface QueuedTilepack { pack: Tilepack; force: boolean; required: boolean; }

export const TILEPACK_MANIFEST_URL = 'https://storage.googleapis.com/buildinged-online.appspot.com/tilepacks.json';

@Injectable({
    providedIn: "root",
})
export class TileService {

  constructor(private db: DbService, private http: HttpClient) { }

    failedDecodes: string[] = [];
    totalTiles = 0;
    processedTiles = 0;
    private progressStarted = false;
    private queue: QueuedTilepack[] = [];
    private running: Promise<void> | null = null;

    get isDownloading(): boolean { return !!this.running; }

    private progressSubject = new BehaviorSubject<TileDownloadProgress>({
      active: false,
      totalTiles: 0,
      processedTiles: 0,
      failedSheets: 0,
    });
    readonly progress$ = this.progressSubject.asObservable();

    tilepacks: Tilepack[] = [];

    async saveTilesetToIndexedDb(name: string, url: string) {

    }

    private resetProgress(): void {
      this.failedDecodes = [];
      this.totalTiles = 0;
      this.processedTiles = 0;
      this.progressStarted = false;
      this.progressSubject.next({
        active: false,
        totalTiles: 0,
        processedTiles: 0,
        failedSheets: 0,
      });
    }

    private ensureProgressStarted(currentPackName?: string, currentSheetName?: string): void {
      if (this.progressStarted) {
        return;
      }

      this.progressStarted = true;
      this.progressSubject.next({
        active: true,
        totalTiles: this.totalTiles,
        processedTiles: this.processedTiles,
        failedSheets: this.failedDecodes.length,
        currentPackName,
        currentSheetName,
      });
    }

    private updateProgress(partial: Partial<TileDownloadProgress> = {}): void {
      const current = this.progressSubject.getValue();
      this.progressSubject.next({
        ...current,
        totalTiles: this.totalTiles,
        processedTiles: this.processedTiles,
        ...partial,
      });
    }

    private endProgress(): void {
      this.updateProgress({
        active: false,
        currentPackName: undefined,
        currentSheetName: undefined,
        detail: undefined,
        failedSheets: this.failedDecodes.length,
      });
    }

    /** Queues packs for download. Requests made during a download run after it rather than being dropped. */
    processTilepacks(tilepacks: Tilepack[], tilepackIndex = 0): Promise<void> {
      tilepacks.slice(tilepackIndex).forEach(pack => this.enqueue(pack, false, isTilepackRequired(pack)));
      return this.drain();
    }

    /** Clears a pack's cached sheets and downloads it again once any current download finishes. */
    redownloadTilepack(pack: Tilepack): Promise<void> {
      this.enqueue(pack, true, true);
      return this.drain();
    }

    private enqueue(pack: Tilepack, force: boolean, required: boolean): void {
      if (pack.disabled) return;
      const queued = this.queue.find(item => item.pack.name === pack.name);
      if (queued) {
        queued.force ||= force;
        queued.required ||= required;
      } else {
        this.queue.push({ pack, force, required });
      }
    }

    private drain(): Promise<void> {
      if (!this.running) {
        this.running = this.runQueue().finally(() => {
          this.running = null;
          if (this.queue.length) void this.drain();
        });
      }
      return this.running;
    }

    private async runQueue(): Promise<void> {
      this.resetProgress();
      try {
        for (let item = this.queue.shift(); item; item = this.queue.shift()) {
          try {
            await this.processTilepack(item);
          } catch (error) {
            console.error(`Error processing tilepack ${item.pack.name}:`, error);
            this.failedDecodes.push(item.pack.url);
            this.updateProgress({ failedSheets: this.failedDecodes.length });
          }
        }
      } finally {
        this.endProgress();
        if (this.failedDecodes.length) console.warn('Tilesheets that failed to load:', this.failedDecodes);
      }
    }

    private async processTilepack({ pack, force, required }: QueuedTilepack): Promise<void> {
      // Admin-disabled packs retain their installed sheets and version, even for a forced redownload.
      if (pack.disabled) return;
      pack.enabled = pack.enabled || isTilepackSelected(pack);
      if (!(pack.enabled || required)) return;

      // Records the version that is fully cached. Sheets are cached by name, so a republished pack must drop its old sheets first.
      const versionKey = `tilepack-version:${pack.name}`;
      const expectedVersion = pack.version ?? 'unversioned';
      if (force || (pack.version && localStorage.getItem(versionKey) !== pack.version)) {
        localStorage.removeItem(versionKey);
        await this.db.clearTiles(pack.name);
      }

      const isZip = pack.url.toLowerCase().endsWith('.zip');
      // Avoid re-downloading and unpacking a whole zip on every visit once it is fully cached.
      if (isZip && localStorage.getItem(versionKey) === expectedVersion && await this.db.hasPackTilesets(pack.name)) return;

      if (this.progressStarted) {
        this.updateProgress({ currentPackName: pack.name, currentSheetName: undefined, detail: undefined });
      }

      const failuresBefore = this.failedDecodes.length;
      const headers = new HttpHeaders().set('Cache-Control', 'no-cache');
      if (isZip) {
        await this.processZipTilepack(pack.url, pack.name, headers);
      } else {
        const tilesheets = await firstValueFrom(this.http.get<any[]>(pack.url, { headers }));
        await this.processTilesheets(tilesheets, pack.name);
      }
      if (this.failedDecodes.length === failuresBefore) localStorage.setItem(versionKey, expectedVersion);
    }

    private downloadZip(zipUrl: string, packName: string, headers: HttpHeaders): Promise<ArrayBuffer> {
      const megabytes = (bytes: number) => Math.floor(bytes / 1048576);
      let shown = -1;
      return new Promise((resolve, reject) => {
        this.http.get(zipUrl, { headers, responseType: 'arraybuffer', reportProgress: true, observe: 'events' }).subscribe({
          next: event => {
            if (event.type === HttpEventType.DownloadProgress && megabytes(event.loaded) !== shown) {
              shown = megabytes(event.loaded);
              this.updateProgress({ currentPackName: packName, detail: `Downloading ${shown} MB${event.total ? ` of ${megabytes(event.total)} MB` : ''}` });
            } else if (event.type === HttpEventType.Response) {
              event.body ? resolve(event.body) : reject(new Error(`Empty response for ${zipUrl}`));
            }
          },
          error: reject,
        });
      });
    }

    private async processZipTilepack(zipUrl: string, packName: string, headers: HttpHeaders): Promise<void> {
      const jszipModule: any = await import('jszip');
      const JSZipLib = jszipModule.default ?? jszipModule;
      this.ensureProgressStarted(packName);
      this.updateProgress({ currentPackName: packName, currentSheetName: undefined, detail: 'Downloading…' });
      const zipBuffer = await this.downloadZip(zipUrl, packName, headers);
      this.updateProgress({ detail: 'Unpacking…' });
      const zip = await JSZipLib.loadAsync(zipBuffer);
      const sheets = await this.pendingSheets(this.getZipTilesheetEntries(zip).map(entry => ({ name: this.getTilesheetName(entry.name), entry })));
      this.updateProgress({ detail: undefined });

      await this.storeSheets(packName, sheets, async ({ entry }) => ({ bytes: await entry.async('uint8array'), source: entry.name }));
    }

    private getZipTilesheetEntries(zip: { files: { [key: string]: JSZipObject } }): JSZipObject[] {
      const files = Object.values(zip.files) as JSZipObject[];
      return files
        .filter(file => !file.dir && /(^|\/)Tiles\/2x\/.+\.png$/i.test(file.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    private getTilesheetName(path: string): string {
      const filename = path.split('/').pop() ?? path;
      return filename.replace(/\.png$/i, '');
    }

    /** Drops duplicate names (first wins) and sheets that are already cached. */
    private async pendingSheets<T extends { name: string }>(sheets: T[]): Promise<T[]> {
      const unique = new Map<string, T>();
      for (const sheet of sheets) {
        if (unique.has(sheet.name)) console.warn(`Duplicate tilesheet ${sheet.name} ignored`);
        else unique.set(sheet.name, sheet);
      }
      const existing = await this.db.existingTilesets([...unique.keys()]);
      return [...unique.values()].filter(sheet => !existing.has(sheet.name));
    }

    /** Stores the original sheet PNGs untouched; tiles are cut from them when needed. */
    private async storeSheets<T extends { name: string }>(packName: string, sheets: T[],
      read: (sheet: T) => Promise<{ bytes: Uint8Array; source: string }>): Promise<void> {
      if (!sheets.length) return;
      this.ensureProgressStarted(packName);
      this.totalTiles += sheets.length;
      this.updateProgress({ currentPackName: packName });

      const maxBatchSheets = 25, maxBatchBytes = 32 * 1024 * 1024;
      let batch: { tileset: Tileset; blob: Blob }[] = [], batchBytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const completed = batch;
        batch = []; batchBytes = 0;
        await this.db.putSheets(completed);
        this.processedTiles += completed.length;
        this.updateProgress();
      };

      for (const sheet of sheets) {
        this.updateProgress({ currentPackName: packName, currentSheetName: sheet.name });
        try {
          const { bytes, source } = await read(sheet);
          const blob = new Blob([bytes], { type: 'image/png' });
          const size = readPngSize(bytes) ?? await this.decodeSize(blob);
          const columns = Math.floor(size.width / TILE_WIDTH), rows = Math.floor(size.height / TILE_HEIGHT);
          if (!columns || !rows) {
            // Effect sprites (blood, rain…) share the folder but hold no whole tiles.
            console.info(`Skipping ${sheet.name}: ${size.width}x${size.height} is smaller than one ${TILE_WIDTH}x${TILE_HEIGHT} tile`);
            this.processedTiles++;
            continue;
          }
          batch.push({ tileset: { name: sheet.name, packName, columns, rows, url: source }, blob });
          batchBytes += bytes.byteLength;
        } catch (error) {
          console.error(`Error processing tilesheet ${sheet.name}:`, error);
          this.failedDecodes.push(sheet.name);
          this.processedTiles++;
          this.updateProgress({ failedSheets: this.failedDecodes.length });
        }
        if (batch.length >= maxBatchSheets || batchBytes >= maxBatchBytes) await flush();
      }
      await flush();
    }

    private async decodeSize(blob: Blob): Promise<{ width: number; height: number }> {
      const bitmap = await createImageBitmap(blob);
      try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
    }

    async processTilesheets(tilesheets: { name: string; url: string }[], packName: string) {
      const sheets = await this.pendingSheets((tilesheets || []).filter(sheet => sheet?.name && sheet?.url));
      await this.storeSheets(packName, sheets, async sheet => ({
        bytes: new Uint8Array(await (await firstValueFrom(this.fetchTilesheet(sheet.url))).arrayBuffer()),
        source: sheet.url,
      }));
    }

    fetchTilesheet(url: string) {
      return this.http.get(url, { responseType: 'blob' });
    }
}
