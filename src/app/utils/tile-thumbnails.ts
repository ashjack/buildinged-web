import { NgZone } from '@angular/core';
import { DbService } from '../services/db.service';

export const MISSING_TILE_IMAGE = 'assets/icons/missing-tile.png';

/**
 * Caches tile thumbnail URLs for templates. Lookups are batched into a later task because querying
 * Dexie during change detection can flush pending promise callbacks mid-render (NG0100).
 */
export class TileThumbnails {
  private images = new Map<string, string>();
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private db: Pick<DbService, 'getTile'>, private zone?: NgZone | null) { }

  get(name: string): string {
    if (!this.images.has(name)) {
      this.images.set(name, MISSING_TILE_IMAGE);
      this.pending.add(name);
      this.timer ??= setTimeout(() => this.flush());
    }
    return this.images.get(name)!;
  }

  set(name: string, url: string): void {
    this.pending.delete(name);
    this.images.set(name, url);
  }

  clear(): void {
    this.generation++;
    this.images.clear();
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    this.timer = null;
    const names = [...this.pending];
    const generation = this.generation;
    this.pending.clear();
    for (const name of names) {
      this.db.getTile(name).then(result => {
        if (!result || this.disposed || generation !== this.generation) return;
        const apply = () => { if (this.images.get(name) === MISSING_TILE_IMAGE) this.images.set(name, result.url); };
        this.zone ? this.zone.run(apply) : apply();
      }).catch(() => { /* Keep the missing-tile placeholder. */ });
    }
  }
}
