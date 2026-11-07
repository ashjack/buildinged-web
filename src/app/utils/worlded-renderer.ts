import { TilezedBounds, TilezedCamera, TilezedViewport } from './tilezed-renderer';
import { WorldedTerrainImage } from './worlded-preview';
import { WorldedLot, WorldedWorld } from './worlded-world';
import { BuildingSprite, drawBuildingSprites } from './building-preview';

const HALF_CELL_WIDTH = 256;
const HALF_CELL_HEIGHT = 128;

export interface WorldedPoint { x: number; y: number; }

export function worldedBounds(world: WorldedWorld): TilezedBounds {
  return {
    left: 0, top: 0,
    right: (world.width + world.height) * HALF_CELL_WIDTH,
    bottom: (world.width + world.height) * HALF_CELL_HEIGHT,
  };
}

export function worldedProject(world: WorldedWorld, x: number, y: number): WorldedPoint {
  return { x: (world.height + x - y) * HALF_CELL_WIDTH, y: (x + y) * HALF_CELL_HEIGHT };
}

export function worldedCellAt(world: WorldedWorld, camera: TilezedCamera, viewport: TilezedViewport,
                              screenX: number, screenY: number): WorldedPoint | undefined {
  const sceneX = camera.x + (screenX - viewport.width / 2) / camera.zoom;
  const sceneY = camera.y + (screenY - viewport.height / 2) / camera.zoom;
  const difference = sceneX / HALF_CELL_WIDTH - world.height;
  const sum = sceneY / HALF_CELL_HEIGHT;
  const x = Math.floor((sum + difference) / 2);
  const y = Math.floor((sum - difference) / 2);
  return x >= 0 && x < world.width && y >= 0 && y < world.height ? { x, y } : undefined;
}

function polygon(context: CanvasRenderingContext2D, world: WorldedWorld,
                 x: number, y: number, width: number, height: number): void {
  const points = [
    worldedProject(world, x, y), worldedProject(world, x + width, y),
    worldedProject(world, x + width, y + height), worldedProject(world, x, y + height),
  ];
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

export function drawWorldedOverview(context: CanvasRenderingContext2D, world: WorldedWorld,
                                    images: readonly WorldedTerrainImage[], selected: WorldedPoint | undefined,
                                    camera: TilezedCamera, viewport: TilezedViewport, pixelRatio: number,
                                    buildings: readonly BuildingSprite[] = [],
                                    renderedLots: ReadonlySet<WorldedLot> = new Set()): void {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = '#202327';
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.setTransform(pixelRatio * camera.zoom, 0, 0, pixelRatio * camera.zoom,
    pixelRatio * (viewport.width / 2 - camera.x * camera.zoom),
    pixelRatio * (viewport.height / 2 - camera.y * camera.zoom));
  context.imageSmoothingEnabled = false;
  context.globalAlpha = 1;
  context.fillStyle = '#343b3c';
  polygon(context, world, 0, 0, world.width, world.height);
  context.fill();

  for (const image of images) {
    const { source, bitmap } = image;
    const origin = worldedProject(world, source.x, source.y);
    const right = worldedProject(world, source.x + source.width, source.y);
    const bottom = worldedProject(world, source.x, source.y + source.height);
    context.save();
    context.transform((right.x - origin.x) / bitmap.width, (right.y - origin.y) / bitmap.width,
      (bottom.x - origin.x) / bitmap.height, (bottom.y - origin.y) / bitmap.height, origin.x, origin.y);
    context.drawImage(bitmap, 0, 0);
    context.restore();
  }

  context.fillStyle = 'rgba(230, 190, 132, 0.8)';
  for (const cell of world.cells.values()) {
    for (const lot of cell.lots) {
      if (!lot.width || !lot.height || renderedLots.has(lot)) continue;
      polygon(context, world, cell.x + lot.x / world.cellSize, cell.y + lot.y / world.cellSize,
        lot.width / world.cellSize, lot.height / world.cellSize);
      context.fill();
    }
  }

  drawBuildingSprites(context, buildings, camera, viewport);

  context.strokeStyle = 'rgba(18, 22, 23, 0.65)';
  context.lineWidth = 1 / camera.zoom;
  context.beginPath();
  for (let x = 0; x <= world.width; x++) {
    const start = worldedProject(world, x, 0), end = worldedProject(world, x, world.height);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  for (let y = 0; y <= world.height; y++) {
    const start = worldedProject(world, 0, y), end = worldedProject(world, world.width, y);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  context.stroke();

  if (selected) {
    polygon(context, world, selected.x, selected.y, 1, 1);
    context.fillStyle = 'rgba(255, 190, 85, 0.2)';
    context.fill();
    context.strokeStyle = '#f1bb67';
    context.lineWidth = 2 / camera.zoom;
    context.stroke();
  }
}
