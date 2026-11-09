import { drawTilezedOverlays, overlayColor, summarizeZones, tilezedLotAtPixel, tilezedTileToPixel } from './tilezed-overlays';
import { WorldedZone } from './worlded-world';

describe('TileZed zone overlays', () => {
  const map = { width: 300, height: 300, tileWidth: 64, tileHeight: 32 };
  const camera = { x: 9600, y: 4800, zoom: 1 };
  const viewport = { width: 20000, height: 20000 };
  const zone = (overrides: Partial<WorldedZone>): WorldedZone => ({
    name: '', group: 'ParkingStall', type: 'ParkingStall', color: '#ff007f', level: 0, geometry: 'rectangle',
    x: 10, y: 20, width: 5, height: 3, points: [], ...overrides,
  });

  function recordingContext() {
    const calls: string[] = [];
    const context = jasmine.createSpyObj<CanvasRenderingContext2D>('context',
      ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'arc']);
    const styles: string[] = [];
    Object.defineProperty(context, 'strokeStyle', { set: (value: string) => styles.push(`stroke ${value}`) });
    Object.defineProperty(context, 'fillStyle', { set: (value: string) => styles.push(`fill ${value}`) });
    context.moveTo.and.callFake((x: number, y: number) => { calls.push(`move ${x},${y}`); });
    return { context, calls, styles };
  }

  it('converts Qt colours, including #aarrggbb, to CSS', () => {
    expect(overlayColor('#ff007f')).toBe('rgba(255, 0, 127, 1)');
    expect(overlayColor('#ff007f', 50 / 255)).toBe('rgba(255, 0, 127, 0.1961)');
    expect(overlayColor('#80aa0000')).toBe('rgba(170, 0, 0, 0.502)');
    expect(overlayColor('nope')).toBe('rgba(128, 128, 128, 1)');
  });

  it('projects tiles and levels like the terrain and building sprites', () => {
    expect(tilezedTileToPixel(map, 0, 0, 0)).toEqual([9600, 0]);
    expect(tilezedTileToPixel(map, 1, 0, 0)).toEqual([9632, 16]);
    expect(tilezedTileToPixel(map, 1, 0, 1)).toEqual([9632, -80]);
  });

  it('draws a black outline, then the colour outline and 50-alpha fill one pixel higher', () => {
    const { context, calls, styles } = recordingContext();
    drawTilezedOverlays(context, map, [], [zone({})], camera, viewport, { lots: true, zones: true });
    const [x, y] = tilezedTileToPixel(map, 10, 20, 0);
    expect(calls).toEqual([`move ${x},${y}`, `move ${x},${y - 1}`]);
    expect(styles).toEqual(['stroke #000', 'fill rgba(255, 0, 127, 0.1961)', 'stroke rgba(255, 0, 127, 1)']);
    expect(context.lineWidth).toBe(2);
  });

  it('outlines lots in dark grey under zones and respects the toggles', () => {
    const lot = { x: 1, y: 2, width: 3, height: 4, level: 0, map: 'house.tbx' };
    let recorded = recordingContext();
    drawTilezedOverlays(recorded.context, map, [lot], [zone({})], camera, viewport, { lots: true, zones: true });
    expect(recorded.styles.filter(style => style.startsWith('fill'))).toEqual([
      'fill rgba(128, 128, 128, 0.1961)', 'fill rgba(255, 0, 127, 0.1961)',
    ]);
    recorded = recordingContext();
    drawTilezedOverlays(recorded.context, map, [lot], [zone({})], camera, viewport, { lots: false, zones: false });
    expect(recorded.context.save).not.toHaveBeenCalled();
  });

  it('culls zones outside the viewport and draws points as circles and polylines without fill', () => {
    const { context, styles } = recordingContext();
    drawTilezedOverlays(context, map, [], [
      zone({ x: 5000, y: 5000 }),
      zone({ geometry: 'point', points: [[3, 4]] }),
      zone({ geometry: 'polyline', points: [[1, 1], [5, 1]], color: '#0000ff' }),
    ], camera, viewport, { lots: true, zones: true });
    expect(context.arc).toHaveBeenCalledOnceWith(...tilezedTileToPixel(map, 3, 4, 0), 10, 0, Math.PI * 2);
    expect(styles).toEqual([
      'fill rgba(255, 0, 127, 0.1961)', 'stroke rgba(255, 0, 127, 1)', 'stroke #000', 'stroke rgba(0, 0, 255, 1)',
    ]);
  });

  it('summarizes zones by group for the legend', () => {
    expect(summarizeZones([zone({}), zone({}), zone({ group: '', type: '', color: '#808080' })])).toEqual([
      { group: 'ParkingStall', color: 'rgba(255, 0, 127, 1)', count: 2 },
      { group: 'Ungrouped', color: 'rgba(128, 128, 128, 1)', count: 1 },
    ]);
  });

  it('hits the grey diamond rather than its rectangular screen bounds at any zoom or tile scale', () => {
    const lot = { x: 10, y: 20, width: 4, height: 4, level: 0, map: 'house.tbx' };
    for (const tileWidth of [64, 128]) {
      const scaledMap = { ...map, tileWidth, tileHeight: tileWidth / 2 };
      for (const zoom of [0.25, 1, 3]) {
        const view = { width: 800, height: 600 };
        const camera = { x: 9000, y: 4500, zoom };
        const screen = (x: number, y: number) => [view.width / 2 + (x - camera.x) * zoom,
          view.height / 2 + (y - camera.y) * zoom] as const;
        const [x, y] = tilezedTileToPixel(scaledMap, 12, 22, 0);
        expect(tilezedLotAtPixel(scaledMap, [lot], camera, view, ...screen(x, y - 1))).toBe(lot);
        // Inside the bounding box, outside the diamond.
        expect(tilezedLotAtPixel(scaledMap, [lot], camera, view,
          ...screen(x - tileWidth * 1.9, y - tileWidth * 0.9 - 1))).toBeUndefined();
        const corner = tilezedTileToPixel(scaledMap, 10, 20, 0);
        expect(tilezedLotAtPixel(scaledMap, [lot], camera, view, ...screen(corner[0], corner[1] - 1))).toBe(lot);
      }
    }
  });

  it('selects the last painted overlapping lot and uses the same level offsets as its overlay', () => {
    const lower = { x: 10, y: 20, width: 10, height: 10, level: -1, map: 'lower.tbx' };
    const upper = { ...lower, level: 1, map: 'upper.tbx' };
    const [x, y] = tilezedTileToPixel(map, 15, 25, 1);
    const camera = { x, y: y - 1, zoom: 1 };
    const viewport = { width: 800, height: 600 };
    expect(tilezedLotAtPixel(map, [upper, lower], camera, viewport, 400, 300)).toBe(upper);
    const later = { ...upper, map: 'later.tbx' };
    expect(tilezedLotAtPixel(map, [upper, later], camera, viewport, 400, 300)).toBe(later);
    const [groundX, groundY] = tilezedTileToPixel(map, 15, 25, 0);
    expect(tilezedLotAtPixel(map, [lower], { x: groundX, y: groundY - 1, zoom: 1 }, viewport, 400, 300)).toBe(lower);
    expect(tilezedLotAtPixel(map, [{ ...lower, width: 0 }], camera, viewport, 400, 300)).toBeUndefined();
  });
});
