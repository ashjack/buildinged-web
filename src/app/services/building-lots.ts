import { BuildingPreview, BuildingSprite, placeBuildingSprite } from '../utils/building-preview';
import { worldedFileFor } from '../utils/worlded-files';
import { WorldedLot } from '../utils/worlded-world';
import { BuildingPreviewService } from './building-preview.service';

const LOOKAHEAD = 6;
const CHANGE_INTERVAL_MS = 250;

export interface PlacedBuildingLot {
  lot: WorldedLot;
  x: number;
  y: number;
  scale: number;
}
interface LoadedPlacement { placement: PlacedBuildingLot; file: File; sprite: BuildingSprite; }
interface LoadedAtlas {
  source: NonNullable<BuildingPreview['composition']>;
  frames: Map<number, ImageBitmap>;
  keys: Set<string>;
}

/** Owns decoded images for one viewer; repeated placements share a bitmap. */
export class BuildingLots {
  readonly sprites: BuildingSprite[] = [];
  readonly warnings = new Set<string>();
  readonly renderedLots = new Set<WorldedLot>();
  loaded = 0;
  revision = 0;
  get compositionSprites(): BuildingSprite[] {
    const ordered = [...this.placements.values()].map(item => item.sprite), placed = new Set(ordered);
    return [...ordered, ...this.sprites.filter(sprite => !placed.has(sprite))];
  }
  private readonly atlases = new Map<File, Map<number, LoadedAtlas>>();
  private readonly sharedTiles = new Map<string, { bitmap: ImageBitmap; references: number }>();
  private readonly atlasIds = new WeakMap<NonNullable<BuildingPreview['composition']>, number>();
  private nextAtlasId = 0;
  private readonly images = new Map<File, Map<number, ImageBitmap>>();
  private readonly failures = new Map<File, Set<number>>();
  private bytes = 0;
  private disposed = false;
  private readonly placements = new Map<WorldedLot, LoadedPlacement>();
  private readonly unrendered = new Map<WorldedLot, { placement: PlacedBuildingLot; file: File; warning?: string }>();
  private readonly fileWarnings = new Map<File, string[]>();
  private refreshGeneration = 0;
  private readonly pendingRefresh = new Set<string>();
  private readonly changedSheets = new Set<string>();
  private refreshing?: Promise<boolean>;
  private activeLots?: Set<WorldedLot>;
  private readonly pendingLots = new Set<WorldedLot>();
  private readonly decodingImages = new Map<File, Map<number, Promise<ImageBitmap>>>();

  private image(file: File, level: number, preview: BuildingPreview): Promise<ImageBitmap> {
    const cached = this.images.get(file)?.get(level);
    if (cached) return Promise.resolve(cached);
    const pending = this.decodingImages.get(file) ?? new Map<number, Promise<ImageBitmap>>();
    this.decodingImages.set(file, pending);
    const existing = pending.get(level);
    if (existing) return existing;
    const request = (async () => {
      const scale = Math.min(1, this.maxSide / Math.max(preview.width, preview.height));
      const width = Math.max(1, Math.ceil(preview.width * scale)), height = Math.max(1, Math.ceil(preview.height * scale));
      const bytes = width * height * 4;
      if (this.bytes + bytes > 96 * 1024 * 1024) throw new Error('Building preview memory limit reached (96 MiB).');
      const bitmap = await createImageBitmap(preview.blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'pixelated' });
      if (this.disposed || this.bytes + bytes > 96 * 1024 * 1024) {
        bitmap.close(); throw new Error(this.disposed ? 'Building viewer was closed.' : 'Building preview memory limit reached (96 MiB).');
      }
      this.bytes += bytes;
      const variants = this.images.get(file) ?? new Map<number, ImageBitmap>();
      variants.set(level, bitmap); this.images.set(file, variants);
      return bitmap;
    })().finally(() => pending.delete(level));
    pending.set(level, request);
    return request;
  }

  constructor(private readonly previews: BuildingPreviewService, private readonly maxSide = 2048,
              private readonly previewWidth = 2048,
              private readonly orderSprites?: (sprites: readonly BuildingSprite[]) => BuildingSprite[],
              private readonly composeTiles = false) { }

  private releaseTiles(keys: ReadonlySet<string>): void {
    for (const key of keys) {
      const tile = this.sharedTiles.get(key);
      if (tile && --tile.references === 0) {
        this.bytes -= tile.bitmap.width * tile.bitmap.height * 4;
        tile.bitmap.close(); this.sharedTiles.delete(key);
      }
    }
  }

  private async loadComposition(file: File, level: number, preview: BuildingPreview, lot: WorldedLot): Promise<BuildingSprite['composition']> {
    if (!this.composeTiles || !preview.composition) return undefined;
    const source = preview.composition;
    const variants = this.atlases.get(file) ?? new Map<number, LoadedAtlas>();
    let atlas = variants.get(level);
    if (atlas?.source !== source) {
      const frames = new Map<number, ImageBitmap>(), keys = new Set<string>();
      let sourceId = this.atlasIds.get(source);
      if (sourceId === undefined) { sourceId = ++this.nextAtlasId; this.atlasIds.set(source, sourceId); }
      const unique = new Map(source.tiles.map(tile => [tile.frame, tile]));
      const pages = new Map<number, { frame: number; key: string }[]>();
      for (const [frame, tile] of unique) {
        const key = tile.sourceKey ? JSON.stringify([tile.sourceKey, tile.sheet, tile.index]) : `${sourceId}:${frame}`;
        const page = Math.floor(frame / 256), pending = pages.get(page) ?? [];
        pending.push({ frame, key }); pages.set(page, pending);
      }
      try {
        for (const [pageIndex, pending] of pages) {
          let page: ImageBitmap | undefined;
          try {
            for (const { frame, key } of pending) {
              if (this.disposed) throw new Error('Building viewer was closed.');
              let tile = this.sharedTiles.get(key);
              if (!tile) {
                if (this.bytes + 64 * 128 * 4 > 96 * 1024 * 1024) throw new Error('Building tile memory limit reached (96 MiB).');
                page ??= await createImageBitmap(source.pages[pageIndex].blob);
                const bitmap = await createImageBitmap(page, frame % 16 * 64, Math.floor(frame % 256 / 16) * 128, 64, 128);
                if (this.disposed || this.bytes + bitmap.width * bitmap.height * 4 > 96 * 1024 * 1024) {
                  bitmap.close(); throw new Error('Building tile is no longer available.');
                }
                // Another in-flight lot may have decoded the same source tile.
                tile = this.sharedTiles.get(key);
                if (tile) bitmap.close();
                else {
                  tile = { bitmap, references: 0 }; this.sharedTiles.set(key, tile);
                  this.bytes += bitmap.width * bitmap.height * 4;
                }
              }
              if (!keys.has(key)) { tile.references++; keys.add(key); }
              frames.set(frame, tile.bitmap);
            }
          } finally { page?.close(); }
        }
      } catch (error) { this.releaseTiles(keys); throw error; }
      if (atlas) this.releaseTiles(atlas.keys);
      atlas = { source, frames, keys }; variants.set(level, atlas); this.atlases.set(file, variants);
    }
    return { tiles: source.tiles, pages: [], frames: atlas.frames, x: lot.x, y: lot.y, level: lot.level };
  }

  async pickTile(x: number, y: number): Promise<{ sheet: string; index: number } | undefined> {
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const sprite = this.sprites[i], b = sprite.bounds;
      if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) continue;
      const item = [...this.placements.values()].find(item => item.sprite === sprite);
      if (!item) continue;
      const hit = await this.previews.pickTile(item.file, Math.max(0, -item.placement.lot.level),
        (x - item.placement.x) / item.placement.scale, (y - item.placement.y) / item.placement.scale);
      if (hit) return hit;
    }
    return undefined;
  }

  async load(lots: readonly PlacedBuildingLot[], files: ReadonlyMap<string, File>, changed: () => void,
    refreshAfterLoad = true): Promise<void> {
    const ordered = lots.filter(item => !this.placements.has(item.lot) && !this.pendingLots.has(item.lot)).sort((a, b) => a.lot.level - b.lot.level);
    ordered.forEach(item => this.pendingLots.add(item.lot));
    try {
    // Previews are requested a few lots ahead so the service can overlap them; results are used in order.
    const requests = new Map<number, Promise<BuildingPreview>>();
    const request = (index: number) => {
      const placement = ordered[index];
      if (!placement || requests.has(index) || this.disposed) return;
      const file = worldedFileFor(files, placement.lot.map);
      const firstLevel = Math.max(0, -placement.lot.level);
      if (!file || this.failures.get(file)?.has(firstLevel)) return;
      const preview = this.previews.preview(file, firstLevel, this.previewWidth);
      preview.catch(() => undefined);
      requests.set(index, preview);
    };
    let lastChanged = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < ordered.length; index++) {
      const placement = ordered[index];
      if (this.disposed) return;
      if (this.activeLots && !this.activeLots.has(placement.lot)) continue;
      for (let ahead = index; ahead < index + LOOKAHEAD; ahead++) request(ahead);
      const file = worldedFileFor(files, placement.lot.map);
      if (!file) {
        this.warnings.add(`Building unavailable: ${placement.lot.map}. Choose the project folder to load it.`);
        continue;
      }
      const firstLevel = Math.max(0, -placement.lot.level);
      if (!this.placements.has(placement.lot) && !this.unrendered.has(placement.lot)) this.unrendered.set(placement.lot, { placement, file });
      if (this.failures.get(file)?.has(firstLevel)) continue;
      try {
        const preview = await (requests.get(index) ?? this.previews.preview(file, firstLevel, this.previewWidth));
        requests.delete(index);
        if (this.disposed) return;
        if (this.activeLots && !this.activeLots.has(placement.lot)) { this.unrendered.delete(placement.lot); continue; }
        preview.warnings.forEach(warning => this.warnings.add(warning));
        this.fileWarnings.set(file, preview.warnings);
        const composition = await this.loadComposition(file, firstLevel, preview, placement.lot);
        const bitmap = composition ? composition.frames!.values().next().value as ImageBitmap
          : await this.image(file, firstLevel, preview);
        if (!bitmap) throw new Error('No building tiles could be loaded.');
        if (this.disposed) return;
        if (this.activeLots && !this.activeLots.has(placement.lot)) continue;
        const sprite = placeBuildingSprite(bitmap, preview, placement.lot, placement.x, placement.y, placement.scale);
        if (composition) sprite.composition = composition;
        if (this.disposed || (this.activeLots && !this.activeLots.has(placement.lot))) continue;
        this.sprites.push(sprite);
        this.placements.set(placement.lot, { placement, file, sprite });
        const previousWarning = this.unrendered.get(placement.lot)?.warning;
        this.unrendered.delete(placement.lot);
        if (previousWarning && ![...this.unrendered.values()].some(item => item.warning === previousWarning)) this.warnings.delete(previousWarning);
        // Reordered once per loaded lot, never in the frame path.
        if (this.orderSprites) this.sprites.splice(0, this.sprites.length, ...this.orderSprites(this.sprites));
        this.renderedLots.add(placement.lot);
        this.loaded++;
        this.revision++;
      } catch (error) {
        if (this.disposed || (this.activeLots && !this.activeLots.has(placement.lot))) { this.unrendered.delete(placement.lot); continue; }
        const warning = `${placement.lot.map}: ${error instanceof Error ? error.message : String(error)}`;
        this.warnings.add(warning);
        this.unrendered.set(placement.lot, { placement, file, warning });
        const failed = this.failures.get(file) ?? new Set<number>();
        failed.add(firstLevel);
        this.failures.set(file, failed);
      }
      // Redraws are throttled because each one repaints the whole visible map.
      if (!this.disposed && performance.now() - lastChanged >= CHANGE_INTERVAL_MS) {
        lastChanged = performance.now();
        changed();
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (!this.disposed) {
      ordered.forEach(item => this.pendingLots.delete(item.lot));
      changed();
      // A release may arrive while initial previews are still in flight.
      if (refreshAfterLoad && this.changedSheets.size) await this.refresh(this.changedSheets, changed);
    }
    } finally { ordered.forEach(item => this.pendingLots.delete(item.lot)); }
  }

  /** Keep loaded images while adding or undoing placements, including loads still in flight. */
  async sync(lots: readonly PlacedBuildingLot[], files: ReadonlyMap<string, File>, changed: () => void): Promise<void> {
    this.activeLots = new Set(lots.map(item => item.lot));
    for (const [lot, item] of this.placements) if (!this.activeLots.has(lot)) {
      const index = this.sprites.indexOf(item.sprite);
      if (index >= 0) this.sprites.splice(index, 1);
      this.placements.delete(lot); this.renderedLots.delete(lot);
      this.revision++;
    }
    for (const lot of this.unrendered.keys()) if (!this.activeLots.has(lot)) this.unrendered.delete(lot);
    changed();
    await this.load(lots, files, changed);
  }

  /** Replace only affected thumbnails, keeping their old images visible until replacements are ready. */
  refresh(names: ReadonlySet<string>, changed: () => void,
    visible: (sprite: BuildingSprite) => boolean = () => true): Promise<boolean> {
    names.forEach(name => { this.pendingRefresh.add(name); this.changedSheets.add(name); });
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      let complete = true;
      try {
        while (this.pendingRefresh.size && !this.disposed) {
          const batch = new Set(this.pendingRefresh); this.pendingRefresh.clear();
          complete = await this.refreshBatch(batch, changed, visible) && complete;
        }
        return complete;
      } finally { this.refreshing = undefined; }
    })();
    return this.refreshing;
  }

  private async refreshBatch(names: ReadonlySet<string>, changed: () => void,
    visible: (sprite: BuildingSprite) => boolean): Promise<boolean> {
    const generation = ++this.refreshGeneration;
    let complete = true;
    const groups = new Map<File, Map<number, LoadedPlacement[]>>();
    for (const item of this.placements.values()) {
      const levels = groups.get(item.file) ?? new Map();
      const level = Math.max(0, -item.placement.lot.level), items = levels.get(level) ?? [];
      items.push(item); levels.set(level, items); groups.set(item.file, levels);
    }
    const jobs: { file: File; level: number; items: LoadedPlacement[] }[] = [];
    for (const [file, levels] of groups) {
      if (await this.previews.usesSheets(file, names)) for (const [level, items] of levels) jobs.push({ file, level, items });
    }
    jobs.sort((a, b) => Number(b.items.some(item => visible(item.sprite))) - Number(a.items.some(item => visible(item.sprite))));
    for (const { file, level, items } of jobs) {
      if (this.disposed || generation !== this.refreshGeneration) return false;
      try {
        const preview = await this.previews.preview(file, level, this.previewWidth);
        const composition = await this.loadComposition(file, level, preview, items[0].placement.lot);
        if (composition) {
          const bitmap = composition.frames!.values().next().value as ImageBitmap;
          if (!bitmap) throw new Error('No building tiles could be loaded.');
          for (const item of items) {
            const index = this.sprites.indexOf(item.sprite), placement = item.placement;
            const replacement = placeBuildingSprite(bitmap, preview, placement.lot, placement.x, placement.y, placement.scale);
            replacement.composition = { ...composition, x: placement.lot.x, y: placement.lot.y, level: placement.lot.level };
            if (index >= 0) this.sprites[index] = replacement;
            item.sprite = replacement;
          }
        } else {
          const scale = Math.min(1, this.maxSide / Math.max(preview.width, preview.height));
          const bitmap = await createImageBitmap(preview.blob, { resizeWidth: Math.max(1, Math.ceil(preview.width * scale)), resizeHeight: Math.max(1, Math.ceil(preview.height * scale)), resizeQuality: 'pixelated' });
          if (this.disposed || generation !== this.refreshGeneration) { bitmap.close(); return false; }
          const variants = this.images.get(file) ?? new Map<number, ImageBitmap>();
          const old = variants.get(level);
          const bytes = bitmap.width * bitmap.height * 4;
          const oldBytes = old ? old.width * old.height * 4 : 0;
          if (this.bytes - oldBytes + bytes > 96 * 1024 * 1024) { bitmap.close(); throw new Error('Building preview memory limit reached (96 MiB).'); }
          for (const item of items) {
            const index = this.sprites.indexOf(item.sprite);
            const placement = item.placement;
            const replacement = placeBuildingSprite(bitmap, preview, placement.lot, placement.x, placement.y, placement.scale);
            if (index >= 0) this.sprites[index] = replacement;
            item.sprite = replacement;
          }
          variants.set(level, bitmap); this.images.set(file, variants); this.bytes += bytes - oldBytes; old?.close();
        }
        this.revision++;
        const previousWarnings = this.fileWarnings.get(file) ?? [];
        this.fileWarnings.set(file, preview.warnings);
        for (const warning of previousWarnings) if (![...this.fileWarnings.values()].some(warnings => warnings.includes(warning))) this.warnings.delete(warning);
        preview.warnings.forEach(warning => this.warnings.add(warning));
        if (this.orderSprites) this.sprites.splice(0, this.sprites.length, ...this.orderSprites(this.sprites));
        changed();
      } catch (error) { complete = false; this.warnings.add(`Could not refresh ${file.name}: ${error instanceof Error ? error.message : String(error)}`); changed(); }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const retry: PlacedBuildingLot[] = [], files = new Map<string, File>();
    for (const { placement, file } of this.unrendered.values()) {
      if (await this.previews.usesSheets(file, names)) {
        this.failures.get(file)?.delete(Math.max(0, -placement.lot.level));
        retry.push(placement); files.set(placement.lot.map, file);
      }
    }
    if (retry.length && !this.disposed) {
      await this.load(retry, files, changed, false);
      if (retry.some(item => this.unrendered.has(item.lot))) complete = false;
    }
    return complete;
  }

  dispose(): void {
    this.disposed = true;
    this.refreshGeneration++;
    this.images.forEach(variants => variants.forEach(bitmap => bitmap.close()));
    this.images.clear();
    this.sharedTiles.forEach(tile => tile.bitmap.close()); this.sharedTiles.clear();
    this.atlases.clear(); this.revision++;
    this.decodingImages.clear(); this.pendingLots.clear();
    this.sprites.length = 0;
    this.renderedLots.clear();
    this.placements.clear(); this.fileWarnings.clear();
    this.unrendered.clear();
    this.pendingRefresh.clear(); this.changedSheets.clear();
  }
}
