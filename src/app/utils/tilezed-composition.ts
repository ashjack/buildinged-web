import type { BuildingSprite } from './building-preview';
import { TilezedScene } from './tilezed-terrain';
import { applyTilezedCamera, spriteForGid, TilezedCamera, TilezedImage, tilezedLayerAboveLots, TilezedViewport } from './tilezed-renderer';

export interface TilezedCompositionDraw {
  bitmap: CanvasImageSource; sx: number; sy: number; sw: number; sh: number;
  x: number; y: number; width: number; height: number; opacity: number;
  layer: string; gid?: number; sheet?: string; index?: number; building?: boolean;
  pickable?: boolean;
}
interface Square {
  x: number; y: number; level: number;
  normal: TilezedCompositionDraw[]; above: TilezedCompositionDraw[];
  lots: Map<number, TilezedCompositionDraw[]>;
}
const layerName = (name: string) => name.replace(/^-?\d+_/, '');
const missingFloors = new Map<string, HTMLCanvasElement>();
function missingFloor(width: number, height: number): HTMLCanvasElement {
  const key = `${width}:${height}`;
  let canvas = missingFloors.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.fillStyle = '#a64b99'; context.beginPath();
    context.moveTo(width / 2, 0); context.lineTo(width, height / 2); context.lineTo(width / 2, height);
    context.lineTo(0, height / 2); context.closePath(); context.fill(); missingFloors.set(key, canvas);
  }
  return canvas;
}

/** PZTools::lotLayerSuppressesLayer, applied only at the same level and square. */
export function lotLayerSuppressesLayer(replacement: string, existing: string): boolean {
  const preservesVegetation = /^(Walls|WallTrim|WallOverlay|WallGrime)/.test(replacement)
    || ['Frames', 'Doors', 'Windows'].includes(replacement);
  return replacement === 'Floor' || replacement === existing || existing.startsWith('Vegetation') && !preservesVegetation;
}

/** CompositeLayerGroup::orderedCellsAt + ZLevelRenderer::drawTileLayerGroup.
 * Finish ordinary tiles, lot tiles and AboveLot tiles at one square before advancing in depth.
 */
export function tilezedComposition(scene: TilezedScene, images: ReadonlyMap<number, TilezedImage>,
  buildings: readonly BuildingSprite[], camera: TilezedCamera, viewport: TilezedViewport, onlyLevel?: number): TilezedCompositionDraw[] {
  const { map } = scene, hw = map.tileWidth / 2, hh = map.tileHeight / 2, scale = map.tileWidth / 64, origin = map.height * hw;
  const left = camera.x - viewport.width / (2 * camera.zoom), right = camera.x + viewport.width / (2 * camera.zoom);
  const top = camera.y - viewport.height / (2 * camera.zoom), bottom = camera.y + viewport.height / (2 * camera.zoom);
  const visible = (draw: Pick<TilezedCompositionDraw, 'x' | 'y' | 'width' | 'height'>) =>
    draw.x + draw.width > left && draw.x < right && draw.y + draw.height > top && draw.y < bottom;
  const squares = new Map<string, Square>();
  const square = (x: number, y: number, level: number): Square => {
    const key = `${level}:${x}:${y}`;
    let value = squares.get(key);
    if (!value) { value = { x, y, level, normal: [], above: [], lots: new Map() }; squares.set(key, value); }
    return value;
  };
  const maxWidth = Math.max(map.tileWidth, ...map.tilesets.map(sheet => sheet.tileWidth));
  const maxHeight = Math.max(map.tileHeight, ...map.tilesets.map(sheet => sheet.tileHeight));
  const first = Math.max(0, Math.floor((top - map.tileHeight) / hh) - 1);
  const last = Math.min(map.width + map.height - 2, Math.ceil((bottom + maxHeight - map.tileHeight) / hh) + 1);
  for (let depth = first; depth <= last && (onlyLevel === undefined || onlyLevel === 0); depth++) {
    const from = Math.max(0, depth - map.height + 1, Math.floor((depth + (left - origin - maxWidth) / hw) / 2));
    const to = Math.min(map.width - 1, depth, Math.ceil((depth + (right - origin + maxWidth) / hw) / 2));
    for (let x = from; x <= to; x++) {
      const y = depth - x;
      for (const layer of scene.layers) {
        const gid = layer.gids[y * map.width + x];
        if (!gid || !layer.visible || !layer.opacity) continue;
        const sprite = spriteForGid(gid, map, images);
        if (!sprite) {
          if (layer.name === '0_Floor') square(x, y, 0).normal.push({ bitmap: missingFloor(map.tileWidth, map.tileHeight),
            sx: 0, sy: 0, sw: map.tileWidth, sh: map.tileHeight, x: origin + (x - y) * hw - hw, y: depth * hh,
            width: map.tileWidth, height: map.tileHeight, opacity: layer.opacity, layer: layer.name, pickable: false });
          continue;
        }
        const draw: TilezedCompositionDraw = { bitmap: sprite.image.bitmap, sx: sprite.sourceX, sy: sprite.sourceY,
          sw: sprite.image.layout.tileWidth, sh: sprite.image.layout.tileHeight,
          x: origin + (x - y) * hw - hw, y: depth * hh + map.tileHeight - sprite.height,
          width: sprite.width, height: sprite.height, opacity: layer.opacity, layer: layer.name, gid };
        if (visible(draw)) (tilezedLayerAboveLots(layer.name) ? square(x, y, 0).above : square(x, y, 0).normal).push(draw);
      }
    }
  }
  buildings.forEach((building, order) => {
    const composition = building.composition;
    if (!composition) {
      if (onlyLevel !== undefined && building.level !== onlyLevel) return;
      // Older/custom preview providers can supply a whole image until they supply tile data.
      const b = building.bounds;
      const draw: TilezedCompositionDraw = { bitmap: building.bitmap, sx: 0, sy: 0, sw: building.bitmap.width,
        sh: building.bitmap.height, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top,
        opacity: 1, layer: '', building: true };
      if (visible(draw)) square(building.squares.maxX, building.squares.maxY, building.level).lots.set(order, [draw]);
      return;
    }
    for (const tile of composition.tiles) {
      const x = composition.x + tile.squareX, y = composition.y + tile.squareY, level = composition.level + tile.level;
      const frame = composition.frames?.get(tile.frame);
      const bitmap = frame ?? composition.pages[Math.floor(tile.frame / 256)];
      if (level < 0 || !bitmap || onlyLevel !== undefined && level !== onlyLevel) continue;
      const draw: TilezedCompositionDraw = { bitmap, sx: frame ? 0 : tile.frame % 16 * 64, sy: frame ? 0 : Math.floor(tile.frame % 256 / 16) * 128,
        sw: 64, sh: 128, x: origin + (x - y) * hw - hw,
        y: (x + y) * hh + map.tileHeight - 128 * scale - level * 96 * scale,
        width: 64 * scale, height: 128 * scale, opacity: 1, layer: tile.layer, sheet: tile.sheet, index: tile.index };
      if (!visible(draw)) continue;
      const cell = square(x, y, level), group = cell.lots.get(order) ?? [];
      group.push(draw); cell.lots.set(order, group);
    }
  });
  const commands: TilezedCompositionDraw[] = [];
  const ordered = [...squares.values()].sort((a, b) => a.level - b.level || a.x + a.y - b.x - b.y || a.x - b.x);
  for (const cell of ordered) {
    let ordinary = cell.normal;
    for (const [, replacements] of [...cell.lots].sort(([a], [b]) => a - b)) {
      ordinary = ordinary.filter(existing => !replacements.some(replacement =>
        lotLayerSuppressesLayer(layerName(replacement.layer), layerName(existing.layer))));
      ordinary.push(...replacements);
    }
    commands.push(...ordinary, ...cell.above);
  }
  return commands;
}

export function drawTilezedComposition(context: CanvasRenderingContext2D, commands: readonly TilezedCompositionDraw[],
  camera: TilezedCamera, viewport: TilezedViewport, pixelRatio: number): void {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.globalAlpha = 1;
  context.fillStyle = '#202327'; context.fillRect(0, 0, viewport.width, viewport.height);
  context.imageSmoothingEnabled = false; applyTilezedCamera(context, camera, viewport, pixelRatio);
  for (const draw of commands) {
    context.globalAlpha = draw.opacity;
    context.drawImage(draw.bitmap, draw.sx, draw.sy, draw.sw, draw.sh, draw.x, draw.y, draw.width, draw.height);
  }
  context.globalAlpha = 1;
}

export function pickTilezedComposition(commands: readonly TilezedCompositionDraw[], x: number, y: number): TilezedCompositionDraw | undefined {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  for (let i = commands.length - 1; i >= 0; i--) {
    const draw = commands[i];
    if (draw.pickable === false) continue;
    if (x < draw.x || y < draw.y || x >= draw.x + draw.width || y >= draw.y + draw.height) continue;
    context.clearRect(0, 0, 1, 1);
    context.drawImage(draw.bitmap, draw.sx + Math.floor((x - draw.x) * draw.sw / draw.width),
      draw.sy + Math.floor((y - draw.y) * draw.sh / draw.height), 1, 1, 0, 0, 1, 1);
    if (context.getImageData(0, 0, 1, 1).data[3]) return draw;
  }
  return undefined;
}
