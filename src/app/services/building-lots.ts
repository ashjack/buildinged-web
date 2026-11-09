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

/** Owns decoded images for one viewer; repeated placements share a bitmap. */
export class BuildingLots {
  readonly sprites: BuildingSprite[] = [];
  readonly warnings = new Set<string>();
  readonly renderedLots = new Set<WorldedLot>();
  loaded = 0;
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

  constructor(private readonly previews: BuildingPreviewService, private readonly maxSide = 2048,
              private readonly previewWidth = 2048,
              private readonly orderSprites?: (sprites: readonly BuildingSprite[]) => BuildingSprite[]) { }

  async load(lots: readonly PlacedBuildingLot[], files: ReadonlyMap<string, File>, changed: () => void,
    refreshAfterLoad = true): Promise<void> {
    const ordered = lots.slice().sort((a, b) => a.lot.level - b.lot.level);
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
        preview.warnings.forEach(warning => this.warnings.add(warning));
        this.fileWarnings.set(file, preview.warnings);
        const variants = this.images.get(file) ?? new Map<number, ImageBitmap>();
        let bitmap = variants.get(firstLevel);
        if (!bitmap) {
          const scale = Math.min(1, this.maxSide / Math.max(preview.width, preview.height));
          const width = Math.max(1, Math.ceil(preview.width * scale));
          const height = Math.max(1, Math.ceil(preview.height * scale));
          const bytes = width * height * 4;
          if (this.bytes + bytes > 96 * 1024 * 1024) throw new Error('Building preview memory limit reached (96 MiB).');
          bitmap = await createImageBitmap(preview.blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'pixelated' });
          if (this.disposed) { bitmap.close(); return; }
          this.bytes += bytes;
          variants.set(firstLevel, bitmap);
          this.images.set(file, variants);
        }
        const sprite = placeBuildingSprite(bitmap, preview, placement.lot, placement.x, placement.y, placement.scale);
        this.sprites.push(sprite);
        this.placements.set(placement.lot, { placement, file, sprite });
        const previousWarning = this.unrendered.get(placement.lot)?.warning;
        this.unrendered.delete(placement.lot);
        if (previousWarning && ![...this.unrendered.values()].some(item => item.warning === previousWarning)) this.warnings.delete(previousWarning);
        // Reordered once per loaded lot, never in the frame path.
        if (this.orderSprites) this.sprites.splice(0, this.sprites.length, ...this.orderSprites(this.sprites));
        this.renderedLots.add(placement.lot);
        this.loaded++;
      } catch (error) {
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
      changed();
      // A release may arrive while initial previews are still in flight.
      if (refreshAfterLoad && this.changedSheets.size) await this.refresh(this.changedSheets, changed);
    }
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
        const scale = Math.min(1, this.maxSide / Math.max(preview.width, preview.height));
        const bitmap = await createImageBitmap(preview.blob, { resizeWidth: Math.max(1, Math.ceil(preview.width * scale)), resizeHeight: Math.max(1, Math.ceil(preview.height * scale)), resizeQuality: 'pixelated' });
        if (this.disposed || generation !== this.refreshGeneration) { bitmap.close(); return false; }
        const variants = this.images.get(file)!;
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
        variants.set(level, bitmap); this.bytes += bytes - oldBytes; old?.close();
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
    this.sprites.length = 0;
    this.renderedLots.clear();
    this.placements.clear(); this.fileWarnings.clear();
    this.unrendered.clear();
    this.pendingRefresh.clear(); this.changedSheets.clear();
  }
}
