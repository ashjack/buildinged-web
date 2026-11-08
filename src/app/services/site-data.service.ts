import { Injectable } from '@angular/core';
import Dexie from 'dexie';
import { Observable } from 'rxjs';
import { DbService } from './db.service';
import { TileService } from './tile.service';
import { TilezedStorageService } from './tilezed-storage.service';
import { WorldedStorageService } from './worlded-storage.service';

/** Marks a tilepack as fully downloaded; meaningless once the tiles are gone. */
const TILEPACK_VERSION_PREFIX = 'tilepack-version:';

/**
 * Clears data the site downloaded or cached: tilesheets and their metadata, TileZed/WorldEd tile and
 * building preview caches, and the viewers' saved copies of the last map and world (the originals on
 * disk are untouched). Building drafts, the sign-in session, tilepack choices and preferences are kept.
 */
@Injectable({ providedIn: 'root' })
export class SiteDataService {
  constructor(
    private readonly tiles: DbService,
    private readonly tilezed: TilezedStorageService,
    private readonly worlded: WorldedStorageService,
    private readonly tileService: TileService,
  ) { }

  get downloading(): boolean { return this.tileService.isDownloading; }

  /** Emits as tile downloads start, progress and finish. */
  get downloadProgress$(): Observable<unknown> { return this.tileService.progress$; }

  async clear(): Promise<void> {
    if (this.downloading) throw new Error('Wait for the tile download to finish before clearing data.');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(TILEPACK_VERSION_PREFIX)) localStorage.removeItem(key);
    }
    const databases: Dexie[] = [this.tiles, this.tilezed, this.worlded];
    await Promise.all(databases.map(db =>
      db.transaction('rw', db.tables, () => Promise.all(db.tables.map(table => table.clear())))));
  }
}
