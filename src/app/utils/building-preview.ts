import { Building, SvgTile } from '../models/app.models';
import { generateBuildingSquares, readBuildingManualTiles, SQUARE_LAYERS } from '../services/native-squares';
import { parseTileName } from './sheet-atlas';
import { TilezedBounds, TilezedCamera, TilezedViewport } from './tilezed-renderer';
import { WorldedLot } from './worlded-world';

/** Inclusive square bounds of the tiles a building actually draws. */
export interface BuildingSquares { minX: number; minY: number; maxX: number; maxY: number; }

export interface BuildingPreview {
  blob: Blob;
  bounds: TilezedBounds;
  squares: BuildingSquares;
  width: number;
  height: number;
  warnings: string[];
}

export interface BuildingSprite {
  bitmap: ImageBitmap;
  bounds: TilezedBounds;
  /** Map level and occupied map squares, used for depth ordering. */
  level: number;
  squares: BuildingSquares;
}

export interface PreviewTile {
  sheet: string;
  index: number;
  x: number;
  y: number;
}

/** Manual TBX layers replace generated tiles at the same level, square and layer. */
export function buildingPreviewTiles(building: Building): SvgTile[] {
  const tiles = new Map<string, SvgTile>();
  for (const tile of [...generateBuildingSquares(building).tiles, ...readBuildingManualTiles(building)]) {
    tiles.set([tile.level, tile.x, tile.y, tile.layer].join(':'), tile);
  }
  return [...tiles.values()];
}

/**
 * Whole-image approximation of TileZed's back-to-front square order. Only overlapping images are
 * constrained; a building is behind another when its occupied squares end at or before the other's
 * start on either ground axis, so neighbours that share a wall line still order correctly.
 */
export function orderTilezedBuildingSprites(sprites: readonly BuildingSprite[]): { sprites: BuildingSprite[]; cyclic: boolean } {
  const centre = ({ squares: s }: BuildingSprite) => s.minX + s.maxX + s.minY + s.maxY;
  const pending = sprites.slice().sort((a, b) => a.level - b.level || centre(a) - centre(b) ||
    (a.squares.minX - a.squares.minY) - (b.squares.minX - b.squares.minY));
  const edges = pending.map(() => [] as number[]);
  const incoming = pending.map(() => 0);
  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const a = pending[i], b = pending[j];
      if (a.bounds.right <= b.bounds.left || b.bounds.right <= a.bounds.left ||
          a.bounds.bottom <= b.bounds.top || b.bounds.bottom <= a.bounds.top) continue;
      let before = i, after = j;
      if (a.level === b.level) {
        const s = a.squares, t = b.squares;
        const aBehind = s.maxX <= t.minX || s.maxY <= t.minY;
        const bBehind = t.maxX <= s.minX || t.maxY <= s.minY;
        if (aBehind === bBehind) continue;
        if (bBehind) { before = j; after = i; }
      }
      edges[before].push(after);
      incoming[after]++;
    }
  }
  const done = pending.map(() => false);
  const ordered: BuildingSprite[] = [];
  let cyclic = false;
  for (let count = 0; count < pending.length; count++) {
    let next = incoming.findIndex((value, index) => !done[index] && value === 0);
    if (next < 0) {
      // Interlocking footprints cannot always be represented by a whole-image order.
      cyclic = true;
      next = done.indexOf(false);
    }
    done[next] = true;
    ordered.push(pending[next]);
    for (const index of edges[next]) incoming[index]--;
  }
  return { sprites: ordered, cyclic };
}

export function buildingSquareBounds(tiles: readonly SvgTile[], firstLevel = 0): BuildingSquares {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of tiles) {
    if (tile.level < firstLevel || tile.hidden || tile.excluded) continue;
    minX = Math.min(minX, tile.x);
    minY = Math.min(minY, tile.y);
    maxX = Math.max(maxX, tile.x);
    maxY = Math.max(maxY, tile.y);
  }
  if (minX > maxX) throw new Error('The building has no visible tiles.');
  return { minX, minY, maxX, maxY };
}

/** Coordinates are native 1x pixels, anchored at the lot's tile (0, 0). */
export function prepareBuildingTiles(tiles: readonly SvgTile[], firstLevel = 0): PreviewTile[] {
  const order = new Map(SQUARE_LAYERS.map((layer, index) => [layer, index]));
  return tiles.filter(tile => tile.level >= firstLevel && !tile.hidden && !tile.excluded)
    .slice().sort((a, b) => a.level - b.level || a.x + a.y - b.x - b.y ||
      a.x - b.x || (order.get(a.layer) ?? 0) - (order.get(b.layer) ?? 0))
    .map(tile => {
      const parsed = parseTileName(tile.name ?? '');
      if (!parsed) throw new Error(`Invalid building tile name: ${tile.name ?? '(missing)'}.`);
      return {
        sheet: parsed.sheet.toLowerCase(), index: parsed.index,
        x: (tile.x - tile.y) * 32 - 32,
        y: (tile.x + tile.y) * 16 - tile.level * 96 - 96,
      };
    });
}

export function buildingPixelBounds(tiles: readonly PreviewTile[]): TilezedBounds {
  if (!tiles.length) throw new Error('The building has no visible tiles.');
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const tile of tiles) {
    left = Math.min(left, tile.x);
    right = Math.max(right, tile.x + 64);
    top = Math.min(top, tile.y);
    bottom = Math.max(bottom, tile.y + 128);
  }
  return { left, right, top, bottom };
}

/** Called after terrain rendering; no parsing, sorting or tile decoding in the frame path. */
export function drawBuildingSprites(
  context: CanvasRenderingContext2D, sprites: readonly BuildingSprite[],
  camera: TilezedCamera, viewport: TilezedViewport,
): number {
  const left = camera.x - viewport.width / (2 * camera.zoom);
  const right = camera.x + viewport.width / (2 * camera.zoom);
  const top = camera.y - viewport.height / (2 * camera.zoom);
  const bottom = camera.y + viewport.height / (2 * camera.zoom);
  let drawn = 0;
  for (const { bitmap, bounds } of sprites) {
    if (bounds.right < left || bounds.left > right || bounds.bottom < top || bounds.top > bottom) continue;
    context.drawImage(bitmap, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    drawn++;
  }
  return drawn;
}

export function placeBuildingSprite(bitmap: ImageBitmap, preview: Pick<BuildingPreview, 'bounds' | 'squares'>,
                                    lot: Pick<WorldedLot, 'x' | 'y' | 'level'>,
                                    x: number, y: number, scale: number): BuildingSprite {
  const { bounds, squares } = preview;
  return { bitmap, level: lot.level, bounds: {
    left: x + bounds.left * scale, right: x + bounds.right * scale,
    top: y + bounds.top * scale, bottom: y + bounds.bottom * scale,
  }, squares: {
    minX: lot.x + squares.minX, minY: lot.y + squares.minY,
    maxX: lot.x + squares.maxX, maxY: lot.y + squares.maxY,
  } };
}
