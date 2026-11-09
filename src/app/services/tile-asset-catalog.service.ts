import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { Tilepack } from '../models/app.models';
import { parseTilepackManifest } from '../utils/tilepack-manifest';
import { tilezedSheetName } from '../utils/tilezed-sheets';

const MANIFEST = 'https://storage.googleapis.com/buildinged-online.appspot.com/tilepacks.json';
export interface IndexedTileSheet { name: string; path: string; size: number; sha256: string; }
export interface TileAssetCatalog { packs: Tilepack[]; indexes: Map<string, Map<string, IndexedTileSheet>>; }

@Injectable({ providedIn: 'root' })
export class TileAssetCatalogService {
  readonly changes$ = new Subject<ReadonlySet<string>>();
  private request?: { promise: Promise<Tilepack[]>; expires: number };
  private readonly indexes = new Map<string, Promise<Map<string, IndexedTileSheet>>>();
  private readonly observed = new Map<string, string>();
  private checking?: Promise<ReadonlySet<string>>;
  constructor(private http: HttpClient) { }

  packs(): Promise<Tilepack[]> {
    if (!this.request || this.request.expires < Date.now()) {
      const promise = firstValueFrom(this.http.get<unknown>(MANIFEST, { headers: { 'Cache-Control': 'no-cache' } })).then(parseTilepackManifest);
      const request = { promise, expires: Date.now() + 60000 }; this.request = request;
      promise.catch(() => { if (this.request === request) this.request = undefined; });
    }
    return this.request.promise;
  }
  async current(): Promise<TileAssetCatalog> {
    const packs = (await this.packs()).filter((pack, i) => i === 0 || localStorage.getItem(pack.name) === '1');
    const indexes = new Map<string, Map<string, IndexedTileSheet>>();
    await Promise.all(packs.filter(pack => pack.sheetIndexUrl).map(async pack => {
      const key = JSON.stringify([pack.sheetIndexUrl, pack.version]);
      let promise = this.indexes.get(key);
      if (!promise) {
        promise = firstValueFrom(this.http.get<unknown>(pack.sheetIndexUrl!)).then(data => {
          const index = data as { format?: number; version?: string; sheets?: IndexedTileSheet[] };
          if (index?.format !== 1 || index.version !== pack.version || !Array.isArray(index.sheets) || index.sheets.length > 20000) throw new Error(`Invalid tilesheet index for ${pack.name}.`);
          const result = new Map<string, IndexedTileSheet>();
          for (const sheet of index.sheets) {
            if (!sheet || typeof sheet.name !== 'string' || sheet.name !== tilezedSheetName(sheet.name) || result.has(sheet.name) ||
                typeof sheet.path !== 'string' || !/\.png$/i.test(sheet.path) || !/^[a-f0-9]{64}$/.test(sheet.sha256) ||
                !Number.isSafeInteger(sheet.size) || sheet.size <= 0 || sheet.size > 64 * 1024 * 1024) throw new Error(`Invalid tilesheet metadata for ${pack.name}.`);
            result.set(sheet.name, sheet);
          }
          return result;
        });
        this.indexes.set(key, promise);
        promise.catch(() => { if (this.indexes.get(key) === promise) this.indexes.delete(key); });
      }
      indexes.set(pack.url, await promise);
    }));
    return { packs, indexes };
  }
  revisions(catalog: TileAssetCatalog, names: readonly string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const raw of names) {
      const name = tilezedSheetName(raw), legacy: unknown[] = [];
      let hash: string | undefined;
      for (const pack of catalog.packs) {
        const index = catalog.indexes.get(pack.url);
        if (!index) legacy.push([pack.name, pack.url, pack.version ?? null]);
        else if (index.has(name)) { hash = index.get(name)!.sha256; break; }
      }
      result.set(name, JSON.stringify([legacy, hash ?? 'missing']));
    }
    return result;
  }
  async keys(names: readonly string[]): Promise<Map<string, string>> {
    const revisions = this.revisions(await this.current(), names);
    const changed = new Set<string>();
    for (const [name, revision] of revisions) {
      if (this.observed.has(name) && this.observed.get(name) !== revision) changed.add(name);
      this.observed.set(name, revision);
    }
    if (changed.size) this.changes$.next(changed);
    return revisions;
  }
  check(force = true): Promise<ReadonlySet<string>> {
    if (this.checking) return this.checking;
    if (force) this.request = undefined;
    const before = new Map(this.observed);
    const promise = this.keys([...before.keys()]).then(keys => new Set([...keys].filter(([name, key]) => before.get(name) !== key).map(([name]) => name)));
    this.checking = promise;
    const done = () => { if (this.checking === promise) this.checking = undefined; };
    promise.then(done, done);
    return promise;
  }
}
