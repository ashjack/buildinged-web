import { TilezedMap, tilesetForGid } from './tilezed-map';
import { TilezedScene } from './tilezed-terrain';
import { TilezedSheetLayout } from './tilezed-sheets';
import type { TilePoint, TileRectangle, TileStamp } from './tilezed-edit';

export interface TilezedCamera { x: number; y: number; zoom: number; }
export interface TilezedViewport { width: number; height: number; }
export interface TilezedBounds { left: number; right: number; top: number; bottom: number; }
export interface TilezedImage { bitmap: ImageBitmap; layout: TilezedSheetLayout; }
export type TilezedLayerPass = 'all' | 'belowLots' | 'aboveLots';

/** Layer names are normalized to include their level when a TMX is read. */
export function tilezedLayerAboveLots(name: string): boolean { return /^(?:\d+_)?AboveLots$/.test(name); }
function layersForPass(scene: TilezedScene, pass: TilezedLayerPass) {
  return pass === 'all' ? scene.layers : scene.layers.filter(layer => tilezedLayerAboveLots(layer.name) === (pass === 'aboveLots'));
}

export function tilezedBounds(map: TilezedMap): TilezedBounds {
  const maxWidth = Math.max(map.tileWidth, ...map.tilesets.map(tileset => tileset.tileWidth));
  const maxHeight = Math.max(map.tileHeight, ...map.tilesets.map(tileset => tileset.tileHeight));
  const horizontalOverhang = Math.max(0, maxWidth - map.tileWidth);
  return {
    left: -horizontalOverhang,
    right: (map.width + map.height) * map.tileWidth / 2 + horizontalOverhang,
    top: map.tileHeight - maxHeight,
    bottom: (map.width + map.height - 2) * map.tileHeight / 2 + map.tileHeight,
  };
}

export function fitTilezedCamera(bounds: TilezedBounds, viewport: TilezedViewport): TilezedCamera {
  const width = Math.max(1, viewport.width - 48);
  const height = Math.max(1, viewport.height - 48);
  const zoom = Math.max(0.001, Math.min(4, width / (bounds.right - bounds.left), height / (bounds.bottom - bounds.top)));
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, zoom };
}

export function constrainTilezedCamera(camera: TilezedCamera, bounds: TilezedBounds, viewport: TilezedViewport): TilezedCamera {
  const center = (value: number, min: number, max: number, visible: number) => {
    if (max - min <= visible) return (min + max) / 2;
    return Math.max(min + visible / 2, Math.min(max - visible / 2, value));
  };
  return {
    ...camera,
    x: center(camera.x, bounds.left, bounds.right, viewport.width / camera.zoom),
    y: center(camera.y, bounds.top, bounds.bottom, viewport.height / camera.zoom),
  };
}

export function zoomTilezedCamera(camera: TilezedCamera, bounds: TilezedBounds, viewport: TilezedViewport,
                                  factor: number, anchorX: number, anchorY: number): TilezedCamera {
  const minimum = fitTilezedCamera(bounds, viewport).zoom / 2;
  const zoom = Math.max(minimum, Math.min(4, camera.zoom * factor));
  const x = camera.x + (anchorX - viewport.width / 2) * (1 / camera.zoom - 1 / zoom);
  const y = camera.y + (anchorY - viewport.height / 2) * (1 / camera.zoom - 1 / zoom);
  return constrainTilezedCamera({ x, y, zoom }, bounds, viewport);
}

interface Sprite {
  image: TilezedImage;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
}

function spriteForGid(gid: number, map: TilezedMap, images: ReadonlyMap<number, TilezedImage>): Sprite | null {
  const tileset = tilesetForGid(map.tilesets, gid);
  const image = tileset ? images.get(tileset.firstGid) : undefined;
  if (!tileset || !image) return null;
  const index = gid - tileset.firstGid;
  const sourceX = (index % tileset.columns) * image.layout.tileWidth;
  const sourceY = Math.floor(index / tileset.columns) * image.layout.tileHeight;
  if (sourceX + image.layout.tileWidth > image.bitmap.width || sourceY + image.layout.tileHeight > image.bitmap.height) return null;
  return { image, sourceX, sourceY, width: tileset.tileWidth, height: tileset.tileHeight };
}

/** Sample actual image pixels in reverse draw order, including transparent overhangs. */
export function pickTilezedTile(scene: TilezedScene, images: ReadonlyMap<number, TilezedImage>, worldX: number, worldY: number, pass: TilezedLayerPass = 'all'):
  { gid: number; layer: string } | undefined {
  const { map } = scene, hw = map.tileWidth / 2, hh = map.tileHeight / 2, origin = map.height * hw;
  const layers = layersForPass(scene, pass);
  const maxWidth = Math.max(map.tileWidth, ...map.tilesets.map(sheet => sheet.tileWidth));
  const maxHeight = Math.max(map.tileHeight, ...map.tilesets.map(sheet => sheet.tileHeight));
  const sample = document.createElement('canvas'); sample.width = sample.height = 1;
  const context = sample.getContext('2d', { willReadFrequently: true })!;
  const first = Math.max(0, Math.floor((worldY - map.tileHeight) / hh));
  const last = Math.min(map.width + map.height - 2, Math.ceil((worldY + maxHeight - map.tileHeight) / hh));
  for (let row = last; row >= first; row--) {
    const from = Math.max(0, row - map.height + 1, Math.floor((row + (worldX - origin + hw - maxWidth) / hw) / 2));
    const to = Math.min(map.width - 1, row, Math.ceil((row + (worldX - origin + hw) / hw) / 2));
    for (let x = to; x >= from; x--) {
      const y = row - x, drawX = origin + (x - y) * hw - hw, bottom = row * hh + map.tileHeight;
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i], gid = layer.gids[y * map.width + x];
        if (!gid || !layer.visible || !layer.opacity) continue;
        const sprite = spriteForGid(gid, map, images);
        if (!sprite || worldX < drawX || worldX >= drawX + sprite.width || worldY < bottom - sprite.height || worldY >= bottom) continue;
        const sx = sprite.sourceX + Math.floor((worldX - drawX) * sprite.image.layout.tileWidth / sprite.width);
        const sy = sprite.sourceY + Math.floor((worldY - bottom + sprite.height) * sprite.image.layout.tileHeight / sprite.height);
        context.clearRect(0, 0, 1, 1); context.drawImage(sprite.image.bitmap, sx, sy, 1, 1, 0, 0, 1, 1);
        if (context.getImageData(0, 0, 1, 1).data[3]) return { gid, layer: layer.name };
      }
    }
  }
  return undefined;
}

/** Draws the pending stamp in world coordinates without changing the document. */
export function drawTilezedStamp(context: CanvasRenderingContext2D, map: TilezedMap,
                                 images: ReadonlyMap<number, TilezedImage>, stamp: TileStamp,
                                 origin: TilePoint, selection?: TileRectangle, opacity = 0.65): void {
  const halfWidth = map.tileWidth / 2, halfHeight = map.tileHeight / 2;
  context.save(); context.globalAlpha = opacity; context.imageSmoothingEnabled = false;
  // Match the map's isometric depth order for overlapping tiles in a multi-tile stamp.
  for (let depth = 0; depth < stamp.width + stamp.height - 1; depth++) {
    for (let sx = Math.max(0, depth - stamp.height + 1); sx <= Math.min(stamp.width - 1, depth); sx++) {
      const sy = depth - sx, x = origin.x + sx, y = origin.y + sy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height ||
          (selection && (x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height))) continue;
      const gid = stamp.gids[sy * stamp.width + sx];
      const sprite = gid ? spriteForGid(gid, map, images) : null;
      if (!sprite) continue;
      context.drawImage(sprite.image.bitmap, sprite.sourceX, sprite.sourceY, sprite.image.layout.tileWidth, sprite.image.layout.tileHeight,
        map.height * halfWidth + (x - y) * halfWidth - halfWidth,
        (x + y) * halfHeight + map.tileHeight - sprite.height, sprite.width, sprite.height);
    }
  }
  context.restore();
}

/** Maps world pixels to canvas pixels for the current camera. */
export function applyTilezedCamera(context: CanvasRenderingContext2D, camera: TilezedCamera,
                                   viewport: TilezedViewport, pixelRatio: number): void {
  context.setTransform(pixelRatio * camera.zoom, 0, 0, pixelRatio * camera.zoom,
    pixelRatio * (viewport.width / 2 - camera.x * camera.zoom),
    pixelRatio * (viewport.height / 2 - camera.y * camera.zoom));
}

/** Draws cells in isometric depth order, clipping traversal to the visible viewport. */
export function drawTilezedScene(context: CanvasRenderingContext2D, scene: TilezedScene,
                                 images: Map<number, TilezedImage>, camera: TilezedCamera,
                                 viewport: TilezedViewport, pixelRatio: number, pass: TilezedLayerPass = 'all'): void {
  const { map } = scene;
  const layers = layersForPass(scene, pass);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.globalAlpha = 1;
  if (pass === 'aboveLots') context.clearRect(0, 0, viewport.width, viewport.height);
  else { context.fillStyle = '#202327'; context.fillRect(0, 0, viewport.width, viewport.height); }
  context.imageSmoothingEnabled = false;
  applyTilezedCamera(context, camera, viewport, pixelRatio);

  const halfWidth = map.tileWidth / 2;
  const halfHeight = map.tileHeight / 2;
  const originX = map.height * halfWidth;
  const maxWidth = Math.max(map.tileWidth, ...scene.usedSheets.map(item => item.tileset.tileWidth));
  const maxHeight = Math.max(map.tileHeight, ...scene.usedSheets.map(item => item.tileset.tileHeight));
  const left = camera.x - viewport.width / (2 * camera.zoom);
  const right = camera.x + viewport.width / (2 * camera.zoom);
  const top = camera.y - viewport.height / (2 * camera.zoom);
  const bottom = camera.y + viewport.height / (2 * camera.zoom);
  const firstRow = Math.max(0, Math.floor((top - map.tileHeight) / halfHeight) - 1);
  const lastRow = Math.min(map.width + map.height - 2, Math.ceil((bottom + maxHeight - map.tileHeight) / halfHeight) + 1);
  const sprites = new Map<number, Sprite | null>();
  let opacity = 1;
  const spriteFor = (gid: number): Sprite | null => {
    const cached = sprites.get(gid);
    if (cached !== undefined) return cached;
    const sprite = spriteForGid(gid, map, images);
    sprites.set(gid, sprite);
    return sprite;
  };

  for (let row = firstRow; row <= lastRow; row++) {
    const startX = Math.max(0, row - map.height + 1, Math.floor((row + (left - originX - maxWidth) / halfWidth) / 2));
    const endX = Math.min(map.width - 1, row, Math.ceil((row + (right - originX + maxWidth) / halfWidth) / 2));
    for (let x = startX; x <= endX; x++) {
      const y = row - x;
      const index = y * map.width + x;
      const drawX = originX + (x - y) * halfWidth - halfWidth;
      const drawBottom = row * halfHeight + map.tileHeight;
      for (const layer of layers) {
        const gid = layer.gids[index];
        if (!gid || !layer.visible || !layer.opacity) continue;
        const sprite = spriteFor(gid);
        if (opacity !== layer.opacity) {
          opacity = layer.opacity;
          context.globalAlpha = opacity;
        }
        if (!sprite) {
          if (layer.name === '0_Floor') {
            context.fillStyle = '#a64b99';
            context.beginPath();
            context.moveTo(drawX + halfWidth, drawBottom - map.tileHeight);
            context.lineTo(drawX + map.tileWidth, drawBottom - halfHeight);
            context.lineTo(drawX + halfWidth, drawBottom);
            context.lineTo(drawX, drawBottom - halfHeight);
            context.closePath();
            context.fill();
          }
          continue;
        }
        context.drawImage(sprite.image.bitmap, sprite.sourceX, sprite.sourceY,
          sprite.image.layout.tileWidth, sprite.image.layout.tileHeight,
          drawX, drawBottom - sprite.height, sprite.width, sprite.height);
      }
    }
  }
  context.globalAlpha = 1;
}
