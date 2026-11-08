import { TilezedCamera, TilezedViewport } from './tilezed-renderer';
import { WorldedLot, WorldedZone } from './worlded-world';

/** WorldEd's SubMapItem colour for building lots (Qt::darkGray). */
export const LOT_OUTLINE_COLOR = '#808080';
/** QBrush alpha used by drawFancyRectangle and ObjectItem::paint. */
const FILL_ALPHA = 50 / 255;
/** WorldEd draws point objects as a 10-pixel-radius circle. */
const POINT_RADIUS = 10;

export interface TilezedOverlayMap { width: number; height: number; tileWidth: number; tileHeight: number; }
export interface TilezedOverlayOptions { lots: boolean; zones: boolean; }
export interface TilezedZoneSummary { group: string; color: string; count: number; }

type Point = [number, number];

/** Converts #rgb, #rrggbb or Qt's #aarrggbb to CSS; `alpha` replaces the colour's own alpha (as QColor::setAlpha). */
export function overlayColor(color: string, alpha?: number): string {
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(char => char + char).join('');
  let own = 1;
  if (hex.length === 8) {
    own = parseInt(hex.slice(0, 2), 16) / 255;
    hex = hex.slice(2);
  }
  const value = parseInt(hex, 16);
  const a = +(alpha ?? own).toFixed(4);
  if (hex.length !== 6 || Number.isNaN(value) || Number.isNaN(a)) return `rgba(128, 128, 128, ${alpha ?? 1})`;
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${a})`;
}

/** Tile coordinates to world pixels, using the same projection as the terrain and building sprites. */
export function tilezedTileToPixel(map: TilezedOverlayMap, x: number, y: number, level: number): Point {
  return [
    map.height * map.tileWidth / 2 + (x - y) * map.tileWidth / 2,
    (x + y) * map.tileHeight / 2 - level * 96 * map.tileWidth / 64,
  ];
}

export function summarizeZones(zones: readonly WorldedZone[]): TilezedZoneSummary[] {
  const groups = new Map<string, TilezedZoneSummary>();
  for (const zone of zones) {
    const name = zone.group || zone.type || 'Ungrouped';
    const summary = groups.get(name);
    if (summary) summary.count++;
    else groups.set(name, { group: name, color: overlayColor(zone.color), count: 1 });
  }
  return Array.from(groups.values());
}

function rectangle(map: TilezedOverlayMap, x: number, y: number, width: number, height: number, level: number): Point[] {
  return [
    tilezedTileToPixel(map, x, y, level),
    tilezedTileToPixel(map, x + width, y, level),
    tilezedTileToPixel(map, x + width, y + height, level),
    tilezedTileToPixel(map, x, y + height, level),
  ];
}

function trace(context: CanvasRenderingContext2D, points: readonly Point[], offsetY: number, close: boolean): void {
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y + offsetY) : context.moveTo(x, y + offsetY));
  if (close) context.closePath();
}

/**
 * Draws building lot outlines and then zones over the map, in the style of WorldEd's CellScene:
 * a black outline, then the colour outline and translucent fill one pixel higher.
 */
export function drawTilezedOverlays(context: CanvasRenderingContext2D, map: TilezedOverlayMap,
                                    lots: readonly WorldedLot[], zones: readonly WorldedZone[],
                                    camera: TilezedCamera, viewport: TilezedViewport,
                                    options: TilezedOverlayOptions): void {
  if ((!options.lots || !lots.length) && (!options.zones || !zones.length)) return;
  const margin = POINT_RADIUS + 4 / camera.zoom;
  const left = camera.x - viewport.width / (2 * camera.zoom) - margin;
  const right = camera.x + viewport.width / (2 * camera.zoom) + margin;
  const top = camera.y - viewport.height / (2 * camera.zoom) - margin;
  const bottom = camera.y + viewport.height / (2 * camera.zoom) + margin;
  const visible = (points: readonly Point[]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return maxX >= left && minX <= right && maxY >= top && minY <= bottom;
  };

  context.save();
  context.globalAlpha = 1;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  // Cosmetic two-pixel pen.
  context.lineWidth = 2 / camera.zoom;
  const fancy = (points: readonly Point[], color: string, close: boolean, fill: boolean) => {
    trace(context, points, 0, close);
    context.strokeStyle = '#000';
    context.stroke();
    trace(context, points, -1, close);
    if (fill) {
      context.fillStyle = overlayColor(color, FILL_ALPHA);
      context.fill();
    }
    context.strokeStyle = overlayColor(color);
    context.stroke();
  };

  if (options.lots) {
    const ordered = lots.filter(lot => lot.width > 0 && lot.height > 0).sort((a, b) => a.level - b.level);
    for (const lot of ordered) {
      // SubMapItem outlines at level 0 when the building occupies it; upper-floor lots use their own level.
      const points = rectangle(map, lot.x, lot.y, lot.width, lot.height, Math.max(0, lot.level));
      if (visible(points)) fancy(points, LOT_OUTLINE_COLOR, true, true);
    }
  }

  if (options.zones) {
    for (const zone of zones) {
      if (zone.geometry === 'point') {
        const [x, y] = tilezedTileToPixel(map, zone.points[0][0], zone.points[0][1], zone.level);
        if (x + POINT_RADIUS < left || x - POINT_RADIUS > right || y + POINT_RADIUS < top || y - POINT_RADIUS > bottom) continue;
        context.beginPath();
        context.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
        context.fillStyle = overlayColor(zone.color, FILL_ALPHA);
        context.fill();
        context.strokeStyle = overlayColor(zone.color);
        context.stroke();
        continue;
      }
      const points = zone.geometry === 'rectangle'
        ? rectangle(map, zone.x, zone.y, zone.width, zone.height, zone.level)
        : zone.points.map(([x, y]) => tilezedTileToPixel(map, x, y, zone.level));
      if (visible(points)) fancy(points, zone.color, zone.geometry !== 'polyline', zone.geometry !== 'polyline');
    }
  }
  context.restore();
}
