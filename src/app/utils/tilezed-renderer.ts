import { TilezedMap, tilesetForGid } from './tilezed-map';
import { TilezedScene } from './tilezed-terrain';
import { TilezedSheetLayout } from './tilezed-sheets';

export interface TilezedCamera { x: number; y: number; zoom: number; }
export interface TilezedViewport { width: number; height: number; }
export interface TilezedBounds { left: number; right: number; top: number; bottom: number; }
export interface TilezedImage { bitmap: ImageBitmap; layout: TilezedSheetLayout; }

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

/** Draws cells in isometric depth order, clipping traversal to the visible viewport. */
export function drawTilezedScene(context: CanvasRenderingContext2D, scene: TilezedScene,
                                 images: Map<number, TilezedImage>, camera: TilezedCamera,
                                 viewport: TilezedViewport, pixelRatio: number): void {
  const { map } = scene;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = '#202327';
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.imageSmoothingEnabled = false;
  context.setTransform(pixelRatio * camera.zoom, 0, 0, pixelRatio * camera.zoom,
    pixelRatio * (viewport.width / 2 - camera.x * camera.zoom),
    pixelRatio * (viewport.height / 2 - camera.y * camera.zoom));

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
    const tileset = tilesetForGid(map.tilesets, gid);
    const image = tileset ? images.get(tileset.firstGid) : undefined;
    if (!tileset || !image) {
      sprites.set(gid, null);
      return null;
    }
    const index = gid - tileset.firstGid;
    const sprite: Sprite = {
      image,
      sourceX: (index % tileset.columns) * image.layout.tileWidth,
      sourceY: Math.floor(index / tileset.columns) * image.layout.tileHeight,
      width: tileset.tileWidth,
      height: tileset.tileHeight,
    };
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
      for (const layer of scene.layers) {
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
