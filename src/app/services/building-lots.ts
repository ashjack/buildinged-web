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

  constructor(private readonly previews: BuildingPreviewService, private readonly maxSide = 2048,
              private readonly previewWidth = 2048,
              private readonly orderSprites?: (sprites: readonly BuildingSprite[]) => BuildingSprite[]) { }

  async load(lots: readonly PlacedBuildingLot[], files: ReadonlyMap<string, File>, changed: () => void): Promise<void> {
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
      if (this.failures.get(file)?.has(firstLevel)) continue;
      try {
        const preview = await (requests.get(index) ?? this.previews.preview(file, firstLevel, this.previewWidth));
        requests.delete(index);
        if (this.disposed) return;
        preview.warnings.forEach(warning => this.warnings.add(warning));
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
        this.sprites.push(placeBuildingSprite(bitmap, preview, placement.lot, placement.x, placement.y, placement.scale));
        // Reordered once per loaded lot, never in the frame path.
        if (this.orderSprites) this.sprites.splice(0, this.sprites.length, ...this.orderSprites(this.sprites));
        this.renderedLots.add(placement.lot);
        this.loaded++;
      } catch (error) {
        this.warnings.add(`${placement.lot.map}: ${error instanceof Error ? error.message : String(error)}`);
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
    if (!this.disposed) changed();
  }

  dispose(): void {
    this.disposed = true;
    this.images.forEach(variants => variants.forEach(bitmap => bitmap.close()));
    this.images.clear();
    this.sprites.length = 0;
    this.renderedLots.clear();
  }
}
