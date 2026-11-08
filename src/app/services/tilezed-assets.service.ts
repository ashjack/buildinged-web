import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Tilepack } from '../models/app.models';
import { TilezedTileset } from '../utils/tilezed-map';
import { parseTilepackManifest } from '../utils/tilepack-manifest';
import { tilezedSheetName } from '../utils/tilezed-sheets';
import { DbService } from './db.service';
import { TileService, TILEPACK_MANIFEST_URL } from './tile.service';
import { TilepackHttpError, TilezedArchiveService, TilezedArchiveSheets } from './tilezed-archive.service';
import { TilezedStorageService } from './tilezed-storage.service';

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
  private manifestRequest?: { packs: Promise<Tilepack[]>; expires: number };
  private readonly packFailures = new Map<string, { detail: string; permanent: boolean; expires: number }>();
  private readonly jsonPacks = new Map<string, { list: Promise<unknown>; expires: number }>();

  constructor(
    private readonly db: DbService,
    private readonly storage: TilezedStorageService,
    private readonly http: HttpClient,
    private readonly tileService: TileService,
    private readonly archives: TilezedArchiveService,
  ) { }

  /**
   * Identifies the tilepacks `load` can use. Built only from the published manifest and the saved
   * enabled flags, so it is the same whether or not the BuildingEd editor was opened in this tab.
   */
  async configurationKey(): Promise<string> {
    let packs: Tilepack[] = [];
    try { packs = await this.manifest(); } catch { /* load() reports the failure */ }
    return JSON.stringify(packs.map((pack, index) =>
      [pack.name, pack.url, pack.version ?? null, this.usesPack(pack, index)]));
  }

  private usesPack(pack: Tilepack, index: number): boolean {
    return index === 0 || localStorage.getItem(pack.name) === '1';
  }

  async load(tilesets: readonly TilezedTileset[]): Promise<TilezedAssets> {
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
      packs = available.filter((pack, index) => this.usesPack(pack, index));
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
    const now = Date.now();
    if (!this.manifestRequest || this.manifestRequest.expires <= now) {
      const packs = firstValueFrom(this.http.get<unknown>(TILEPACK_MANIFEST_URL, {
        headers: { 'Cache-Control': 'no-cache' },
      })).then(parseTilepackManifest);
      const request = { packs, expires: now + MANIFEST_TTL_MS };
      this.manifestRequest = request;
      packs.catch(() => { if (this.manifestRequest === request) this.manifestRequest = undefined; });
    }
    return this.manifestRequest.packs;
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
