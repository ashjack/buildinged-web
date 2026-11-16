import type { BuildingSprite } from './building-preview';
import { drawTilezedComposition, tilezedComposition, TilezedCompositionDraw } from './tilezed-composition';
import { TilezedCamera, TilezedImage, TilezedViewport } from './tilezed-renderer';
import { TerrainRegion, TilezedScene } from './tilezed-terrain';

/** Redraw every sprite intersecting the changed terrain pixels, preserving lot/layer depth order. */
export function drawTilezedTerrainRegion(context: CanvasRenderingContext2D, scene: TilezedScene,
  images: ReadonlyMap<number, TilezedImage>, buildings: readonly BuildingSprite[], dirty: TerrainRegion,
  camera: TilezedCamera, viewport: TilezedViewport, pixelRatio: number, onlyLevel?: number): TilezedCompositionDraw[] {
  const map = scene.map, hw = map.tileWidth / 2, hh = map.tileHeight / 2;
  const maxWidth = Math.max(map.tileWidth, ...map.tilesets.map(sheet => sheet.tileWidth + Math.abs(sheet.offsetX ?? 0)));
  const maxHeight = Math.max(map.tileHeight, ...map.tilesets.map(sheet => sheet.tileHeight + Math.abs(sheet.offsetY ?? 0)));
  const x0 = map.height * hw + (dirty.x - dirty.y - dirty.height) * hw - maxWidth;
  const x1 = map.height * hw + (dirty.x + dirty.width - dirty.y) * hw + maxWidth;
  const y0 = (dirty.x + dirty.y) * hh - maxHeight;
  const y1 = (dirty.x + dirty.y + dirty.width + dirty.height) * hh + maxHeight;
  const screenX = (x: number) => (viewport.width / 2 + (x - camera.x) * camera.zoom) * pixelRatio;
  const screenY = (y: number) => (viewport.height / 2 + (y - camera.y) * camera.zoom) * pixelRatio;
  const left = Math.max(0, Math.floor(screenX(x0)) - 1), right = Math.min(context.canvas.width, Math.ceil(screenX(x1)) + 1);
  const top = Math.max(0, Math.floor(screenY(y0)) - 1), bottom = Math.min(context.canvas.height, Math.ceil(screenY(y1)) + 1);
  if (left >= right || top >= bottom) return [];
  const clipViewport = { width: (right - left) / pixelRatio, height: (bottom - top) / pixelRatio };
  const clipCamera = { ...camera,
    x: camera.x + ((left + right) / (2 * pixelRatio) - viewport.width / 2) / camera.zoom,
    y: camera.y + ((top + bottom) / (2 * pixelRatio) - viewport.height / 2) / camera.zoom };
  const commands = tilezedComposition(scene, images, buildings, clipCamera, clipViewport, onlyLevel);
  context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
  context.beginPath(); context.rect(left, top, right - left, bottom - top); context.clip();
  drawTilezedComposition(context, commands, camera, viewport, pixelRatio); context.restore();
  return commands;
}
