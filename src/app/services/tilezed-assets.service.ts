import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Tilepack } from '../models/app.models';
import { TilezedTileset } from '../utils/tilezed-map';
import { tilezedSheetName } from '../utils/tilezed-sheets';
import { DbService } from './db.service';
import { TileService } from './tile.service';
import { TilepackHttpError, TilezedArchiveService, TilezedArchiveSheets } from './tilezed-archive.service';
import { TilezedStorageService } from './tilezed-storage.service';
import { TileAssetCatalog, TileAssetCatalogService } from './tile-asset-catalog.service';
import { isTilepackSelected } from '../utils/tilepack-manifest';

export interface TilezedAssets {
  sheets: Map<number, Blob>;
  errors: Map<number, string>;
  warnings: string[];
}

function sheetNames(tileset: TilezedTileset): string[] {
  return [...new Set([tilezedSheetName(tileset.name), tilezedSheetName(tileset.source)])];
}

function errorText(error: unknown): string {
  if (error instanceof HttpErrorResponse) return `HTTP ${error.status || 'request failed'}`;
  return error instanceof Error ? error.message : String(error);
}

const MANIFEST_TTL_MS = 60000;
const MISSING_SHEET = 'sheet not found in configured tilepacks';

/** The pack itself is absent or forbidden, rather than temporarily unreachable. */
function isMissingPack(error: unknown): boolean {
  const status = error instanceof HttpErrorResponse || error instanceof TilepackHttpError ? error.status : 0;
  return status === 403 || status === 404 || status === 410;
}

@Injectable({ providedIn: 'root' })
export class TilezedAssetsService {
  private readonly packFailures = new Map<string, { detail: string; permanent: boolean; expires: number }>();
  private readonly jsonPacks = new Map<string, { list: Promise<unknown>; expires: number }>();

  constructor(
    private readonly db: DbService,
    private readonly storage: TilezedStorageService,
    private readonly http: HttpClient,
    private readonly tileService: TileService,
    private readonly archives: TilezedArchiveService,
    private readonly catalog: TileAssetCatalogService,
  ) { }

  get changes$() { return this.catalog.changes$; }
  sheetKeys(names: readonly string[]): Promise<Map<string, string>> { return this.catalog.keys(names); }
  checkForUpdates(force = true): Promise<ReadonlySet<string>> { return this.catalog.check(force); }

  /**
   * Identifies the tilepacks `load` can use. Built only from the published manifest and the saved
   * enabled flags, so it is the same whether or not the BuildingEd editor was opened in this tab.
   */
  async configurationKey(): Promise<string> {
    let packs: Tilepack[] = [];
    try { packs = await this.manifest(); } catch { /* load() reports the failure */ }
    return JSON.stringify(packs.map(pack =>
      [pack.name, pack.url, pack.version ?? null, isTilepackSelected(pack)]));
  }

  async load(tilesets: readonly TilezedTileset[]): Promise<TilezedAssets> {
    try {
      await this.catalog.keys(tilesets.map(sheet => sheet.name));
      const catalog = await this.catalog.current();
      if (catalog.indexes.size) return this.loadIndexed(tilesets, catalog);
    } catch (error) {
      return { sheets: new Map(), warnings: [], errors: new Map(tilesets.map(sheet =>
        [sheet.firstGid, `${sheet.name}: Could not check tile asset versions: ${errorText(error)}`])) };
    }
    const sheets = new Map<number, Blob>();
    const errors = new Map<number, string>();
    const warnings = new Set<string>();
    const pending = new Map<number, TilezedTileset>();

    const cached = await Promise.all(tilesets.map(tileset => this.cachedSheet(tileset, warnings)));
    tilesets.forEach((tileset, index) => {
      const blob = cached[index];
      if (blob) sheets.set(tileset.firstGid, blob);
      else pending.set(tileset.firstGid, tileset);
    });
    if (!pending.size) return { sheets, errors, warnings: [...warnings] };

    let packs: Tilepack[];
    try {
      const available = await this.manifest();
      if (!available.length) throw new Error('The tilepack manifest contains no usable packs.');
      packs = available.filter(isTilepackSelected);
    } catch (error) {
      const detail = `Could not load the tilepack list: ${errorText(error)}`;
      for (const tileset of pending.values()) errors.set(tileset.firstGid, `${tileset.name}: ${detail}`);
      return { sheets, errors, warnings: [...warnings] };
    }

    const packErrors: string[] = [];
    const unavailable: string[] = [];
    const sheetErrors = new Map<number, string[]>();
    for (const pack of packs) {
      if (!pending.size) break;
      const names = [...new Set([...pending.values()].flatMap(sheetNames))];
      const failed = this.packFailures.get(pack.url);
      if (failed && failed.expires > Date.now()) {
        (failed.permanent ? unavailable : packErrors).push(failed.detail);
        continue;
      }
      let found: TilezedArchiveSheets;
      try {
        found = pack.url.split(/[?#]/, 1)[0].toLowerCase().endsWith('.zip')
          ? await this.archives.load(pack.url, names)
          : await this.loadJsonPack(pack.url, names);
      } catch (error) {
        const detail = `${pack.name}: ${errorText(error)}`;
        const permanent = isMissingPack(error);
        console.warn('Could not inspect tilepack:', detail);
        // Remembered briefly so every building in a world doesn't request the broken pack again.
        this.packFailures.set(pack.url, { detail, permanent, expires: Date.now() + MANIFEST_TTL_MS });
        (permanent ? unavailable : packErrors).push(detail);
        continue;
      }

      for (const [gid, tileset] of pending) {
        const namesForSheet = sheetNames(tileset);
        const name = namesForSheet.find(candidate => found.sheets.has(candidate));
        if (name) {
          const blob = found.sheets.get(name)!;
          sheets.set(gid, blob);
          pending.delete(gid);
          try {
            await this.storage.rememberSheet({ name, blob, packName: pack.name, version: pack.version ?? 'unversioned' });
          } catch (error) {
            warnings.add(`Could not cache ${name}: ${errorText(error)}`);
          }
        } else {
          for (const candidate of namesForSheet) {
            const failure = found.errors.get(candidate);
            if (failure) {
              const details = sheetErrors.get(gid) ?? [];
              details.push(`${pack.name}: ${failure}`);
              sheetErrors.set(gid, details);
              console.warn(`Could not load ${candidate} from ${pack.name}:`, failure);
            }
          }
        }
      }
    }

    for (const [gid, tileset] of pending) {
      const details = [...(sheetErrors.get(gid) ?? []), ...packErrors];
      // A pack that doesn't exist can't supply the sheet, so it counts as missing (and the preview can be cached).
      errors.set(gid, `${tileset.name}: ${details.length ? details.join('; ') :
        [...unavailable, MISSING_SHEET].join('; ')}`);
    }
    return { sheets, errors, warnings: [...warnings] };
  }

  /** Shared briefly so a burst of building previews does not refetch the manifest for every lot. */
  private manifest(): Promise<Tilepack[]> {
    return this.catalog.packs();
  }

  private async hash(blob: Blob): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
  }
  private async loadIndexed(tilesets: readonly TilezedTileset[], catalog: TileAssetCatalog): Promise<TilezedAssets> {
    const sheets = new Map<number, Blob>(), errors = new Map<number, string>(), warnings: string[] = [];
    const pending = new Map(tilesets.map(sheet => [sheet.firstGid, sheet]));
    for (const pack of catalog.packs) {
      if (!pending.size) break;
      const index = catalog.indexes.get(pack.url);
      const requests = new Map<string, { tiles: TilezedTileset[]; revision: string; size?: number }>();
      for (const tile of pending.values()) {
        const name = index ? sheetNames(tile).find(name => index.has(name)) : sheetNames(tile)[0];
        if (!name) continue;
        const entry = index?.get(name), revision = entry?.sha256 ?? `legacy:${pack.url}:${pack.version ?? 'unversioned'}`;
        let blob: Blob | undefined;
        try { blob = await this.storage.versionedSheet(name, revision); } catch { warnings.push(`Could not read the tile cache for ${name}.`); }
        if (blob && entry && blob.size !== entry.size) blob = undefined;
        if (!blob && entry) {
          // Upgrade already-downloaded sheets in place when their bytes still match.
          const old = await this.db.sheetImages.get(name).catch(() => undefined);
          if (old?.blob?.size === entry.size && await this.hash(old.blob) === entry.sha256) {
            blob = old.blob;
            try { await this.storage.rememberVersionedSheet(name, revision, blob); }
            catch { warnings.push(`Could not cache ${name}.`); }
          }
        }
        if (blob) { sheets.set(tile.firstGid, blob); pending.delete(tile.firstGid); }
        else {
          const request = requests.get(name) ?? { tiles: [], revision, size: entry?.size };
          request.tiles.push(tile); requests.set(name, request);
        }
      }
      if (!requests.size) continue;
      let found: TilezedArchiveSheets;
      try { found = /\.zip(?:[?#]|$)/i.test(pack.url) ? await this.archives.load(pack.url, [...requests.keys()]) : await this.loadJsonPack(pack.url, [...requests.keys()]); }
      catch (error) {
        // Never substitute a lower-priority pack for a sheet explicitly owned by this index.
        for (const request of requests.values()) for (const tile of request.tiles) {
          errors.set(tile.firstGid, `${tile.name}: ${errorText(error)}`); if (index) pending.delete(tile.firstGid);
        }
        continue;
      }
      for (const [name, request] of requests) {
        const blob = found.sheets.get(name);
        if (!blob) {
          if (index || found.errors.has(name)) for (const tile of request.tiles) {
            errors.set(tile.firstGid, `${name}: ${found.errors.get(name) ?? 'The indexed tilesheet is missing from its ZIP.'}`);
            if (index) pending.delete(tile.firstGid);
          }
          continue;
        }
        if (index && (blob.size !== request.size || await this.hash(blob) !== request.revision)) {
          for (const tile of request.tiles) { errors.set(tile.firstGid, `${name}: The ZIP contents do not match the published tilesheet index. Retry checking for updates.`); pending.delete(tile.firstGid); }
          continue;
        }
        for (const tile of request.tiles) { sheets.set(tile.firstGid, blob); pending.delete(tile.firstGid); errors.delete(tile.firstGid); }
        try { await this.storage.rememberVersionedSheet(name, request.revision, blob); }
        catch { warnings.push(`Could not cache ${name}.`); }
      }
    }
    for (const tile of pending.values()) if (!errors.has(tile.firstGid)) errors.set(tile.firstGid, `${tile.name}: ${MISSING_SHEET}`);
    return { sheets, errors, warnings };
  }

  private async cachedSheet(tileset: TilezedTileset, warnings: Set<string>): Promise<Blob | undefined> {
    const names = [...new Set([tileset.name, ...sheetNames(tileset)])];
    try {
      for (const name of names) {
        const sheet = await this.db.sheetImages.get(name);
        if (sheet?.blob) return sheet.blob;
      }
    } catch (error) {
      warnings.add(`Could not read BuildingEd's tile cache: ${errorText(error)}`);
    }
    try {
      for (const name of sheetNames(tileset)) {
        const blob = await this.storage.sheet(name);
        if (blob) return blob;
      }
    } catch (error) {
      warnings.add(`Could not read TileZed's tile cache: ${errorText(error)}`);
    }
    return undefined;
  }

  private async loadJsonPack(url: string, names: readonly string[]): Promise<TilezedArchiveSheets> {
    const now = Date.now();
    let cached = this.jsonPacks.get(url);
    if (!cached || cached.expires <= now) {
      const list = firstValueFrom(this.http.get<unknown>(url, { headers: { 'Cache-Control': 'no-cache' } }));
      const request = cached = { list, expires: now + MANIFEST_TTL_MS };
      this.jsonPacks.set(url, request);
      list.catch(() => { if (this.jsonPacks.get(url) === request) this.jsonPacks.delete(url); });
    }
    const data = await cached.list;
    if (!Array.isArray(data)) throw new Error('The tilesheet list is not a list.');
    const wanted = new Set(names);
    const entries = new Map<string, string>();
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null || !('name' in entry) || !('url' in entry) ||
          typeof entry.name !== 'string' || typeof entry.url !== 'string' || !entry.url) continue;
      const name = tilezedSheetName(entry.name);
      if (wanted.has(name) && !entries.has(name)) entries.set(name, entry.url);
    }

    const sheets = new Map<string, Blob>();
    const errors = new Map<string, string>();
    for (const [name, sheetUrl] of entries) {
      try {
        sheets.set(name, await firstValueFrom(this.tileService.fetchTilesheet(sheetUrl)));
      } catch (error) {
        errors.set(name, errorText(error));
      }
    }
    return { sheets, errors };
  }
}
