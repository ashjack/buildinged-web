import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Tilepack } from '../models/app.models';
import { TilezedTileset } from '../utils/tilezed-map';
import { parseTilepackManifest } from '../utils/tilepack-manifest';
import { tilezedSheetName } from '../utils/tilezed-sheets';
import { DbService } from './db.service';
import { TileService, TILEPACK_MANIFEST_URL } from './tile.service';
import { TilezedArchiveService, TilezedArchiveSheets } from './tilezed-archive.service';
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
  return error instanceof Error ? error.message : String(error);
}

@Injectable({ providedIn: 'root' })
export class TilezedAssetsService {
  constructor(
    private readonly db: DbService,
    private readonly storage: TilezedStorageService,
    private readonly http: HttpClient,
    private readonly tileService: TileService,
    private readonly archives: TilezedArchiveService,
  ) { }

  configurationKey(): string {
    const versions = Object.keys(localStorage).filter(key => key.startsWith('tilepack-version:')).sort()
      .map(key => [key, localStorage.getItem(key), localStorage.getItem(key.slice('tilepack-version:'.length))]);
    return JSON.stringify([versions, this.tileService.tilepacks.map(pack =>
      [pack.name, pack.url, pack.enabled, pack.version])]);
  }

  async load(tilesets: readonly TilezedTileset[]): Promise<TilezedAssets> {
    const sheets = new Map<number, Blob>();
    const errors = new Map<number, string>();
    const warnings = new Set<string>();
    const pending = new Map<number, TilezedTileset>();

    for (const tileset of tilesets) {
      const blob = await this.cachedSheet(tileset, warnings);
      if (blob) sheets.set(tileset.firstGid, blob);
      else pending.set(tileset.firstGid, tileset);
    }
    if (!pending.size) return { sheets, errors, warnings: [...warnings] };

    let packs: Tilepack[];
    try {
      const manifest = await firstValueFrom(this.http.get<unknown>(TILEPACK_MANIFEST_URL, {
        headers: { 'Cache-Control': 'no-cache' },
      }));
      const available = parseTilepackManifest(manifest);
      if (!available.length) throw new Error('The tilepack manifest contains no usable packs.');
      packs = available.filter((pack, index) => index === 0 || localStorage.getItem(pack.name) === '1' ||
        this.tileService.tilepacks.some(existing => existing.name === pack.name && existing.enabled));
    } catch (error) {
      const detail = `Could not load the tilepack list: ${errorText(error)}`;
      for (const tileset of pending.values()) errors.set(tileset.firstGid, `${tileset.name}: ${detail}`);
      return { sheets, errors, warnings: [...warnings] };
    }

    const packErrors: string[] = [];
    const sheetErrors = new Map<number, string[]>();
    for (const pack of packs) {
      if (!pending.size) break;
      const names = [...new Set([...pending.values()].flatMap(sheetNames))];
      let found: TilezedArchiveSheets;
      try {
        found = pack.url.split(/[?#]/, 1)[0].toLowerCase().endsWith('.zip')
          ? await this.archives.load(pack.url, names)
          : await this.loadJsonPack(pack.url, names);
      } catch (error) {
        const detail = `${pack.name}: ${errorText(error)}`;
        console.warn('Could not inspect tilepack:', detail);
        packErrors.push(detail);
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
      errors.set(gid, `${tileset.name}: ${details.length ? details.join('; ') : 'sheet not found in configured tilepacks'}`);
    }
    return { sheets, errors, warnings: [...warnings] };
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
    const data = await firstValueFrom(this.http.get<unknown>(url, { headers: { 'Cache-Control': 'no-cache' } }));
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
