import { TilezedMap, TilezedTileset } from './tilezed-map';
import {
  constrainTilezedCamera, drawTilezedScene, drawTilezedStamp, fitTilezedCamera, TilezedBounds,
  TilezedCamera, TilezedImage, zoomTilezedCamera, pickTilezedTile, tilezedLayerAboveLots,
} from './tilezed-renderer';
import { TilezedScene } from './tilezed-terrain';

describe('TileZed canvas navigation and rendering', () => {
  it('recognizes AboveLots with or without its normalized level prefix', () => {
    expect(tilezedLayerAboveLots('AboveLots')).toBeTrue();
    expect(tilezedLayerAboveLots('0_AboveLots')).toBeTrue();
    expect(tilezedLayerAboveLots('0_AboveLotsExtra')).toBeFalse();
  });
  it('separates AboveLots from terrain and preserves transparent pixels and layer opacity', async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const source = document.createElement('canvas'); source.width = source.height = 128;
    const fill = source.getContext('2d')!;
    fill.fillStyle = '#ff0000'; fill.fillRect(0, 0, 64, 128);
    fill.fillStyle = '#0000ff'; fill.fillRect(64, 0, 32, 128);
    const bitmap = await createImageBitmap(source);
    const scene = sceneFor(1, 1, Uint32Array.of(1));
    scene.layers.unshift({ name: '0_AboveLots', gids: Uint32Array.of(2), visible: true, opacity: 0.5 });
    const images = new Map([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]);
    const camera = { x: 32, y: -32, zoom: 1 }, viewport = { width: 128, height: 128 };
    const context = canvas.getContext('2d')!;
    try {
      drawTilezedScene(context, scene, images, camera, viewport, 1, 'belowLots');
      expect([...context.getImageData(40, 64, 1, 1).data]).toEqual([255, 0, 0, 255]);
      drawTilezedScene(context, scene, images, camera, viewport, 1, 'aboveLots');
      expect([...context.getImageData(40, 64, 1, 1).data]).toEqual([0, 0, 255, 128]);
      expect(context.getImageData(80, 64, 1, 1).data[3]).toBe(0);
      expect(pickTilezedTile(scene, images, 10, -50, 'aboveLots')).toEqual({ gid: 2, layer: '0_AboveLots' });
      expect(pickTilezedTile(scene, images, 40, -50, 'aboveLots')).toBeUndefined();
      expect(pickTilezedTile(scene, images, 10, -50, 'belowLots')?.gid).toBe(1);
      scene.layers[0].visible = false;
      drawTilezedScene(context, scene, images, camera, viewport, 1, 'aboveLots');
      expect(context.getImageData(40, 64, 1, 1).data[3]).toBe(0);
      expect(pickTilezedTile(scene, images, 10, -50, 'aboveLots')).toBeUndefined();
    } finally { bitmap.close(); }
  });
  it('picks opaque image overhangs instead of the ground grid and skips transparent foreground pixels', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillRect(0, 0, 64, 128); context.fillRect(64, 0, 32, 128);
    const bitmap = await createImageBitmap(canvas);
    const scene = sceneFor(1, 1, Uint32Array.of(1));
    scene.layers.push({ name: '0_Objects', gids: Uint32Array.of(2), visible: true, opacity: 1 });
    const images = new Map([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]);
    try {
      // These pixels are above the diamond of the only ground square.
      expect(pickTilezedTile(scene, images, 10, -50)).toEqual({ gid: 2, layer: '0_Objects' });
      expect(pickTilezedTile(scene, images, 40, -50)).toEqual({ gid: 1, layer: '0_Floor' });
      scene.layers[1].visible = false;
      expect(pickTilezedTile(scene, images, 10, -50)?.gid).toBe(1);
      expect(pickTilezedTile(scene, images, 70, -50)).toBeUndefined();
    } finally { bitmap.close(); }
  });
  const tileset: TilezedTileset = {
    name: 'test_01', source: 'test_01.png', firstGid: 1, tileWidth: 64, tileHeight: 128,
    imageWidth: 128, imageHeight: 128, columns: 2, rows: 1,
  };
  const sceneFor = (width: number, height: number, gids: Uint32Array): TilezedScene => {
    const map: TilezedMap = {
      width, height, tileWidth: 64, tileHeight: 32, tilesets: [tileset],
      layers: [{ name: '0_Floor', gids, visible: true, opacity: 1 }],
      bitmaps: new Map(), aliases: new Map(), rules: [], blends: [], blendEdgesEverywhere: false, warnings: [],
    };
    return { map, layers: map.layers, usedSheets: [{ tileset, maxIndex: 1 }], warnings: [] };
  };

  it('fits a map, constrains panning, and keeps the zoom anchor fixed when possible', () => {
    const bounds: TilezedBounds = { left: 0, right: 1000, top: 0, bottom: 1000 };
    const viewport = { width: 400, height: 200 };
    const fit = fitTilezedCamera(bounds, viewport);
    expect(fit.x).toBe(500);
    expect(fit.y).toBe(500);
    expect(fit.zoom).toBeCloseTo(0.152, 3);
    expect(constrainTilezedCamera({ x: -100, y: 1200, zoom: 1 }, bounds, viewport))
      .toEqual({ x: 200, y: 900, zoom: 1 });
    const camera: TilezedCamera = { x: 500, y: 500, zoom: 1 };
    const zoomed = zoomTilezedCamera(camera, bounds, viewport, 2, 100, 50);
    expect(zoomed.x + (100 - 200) / zoomed.zoom).toBe(400);
    expect(zoomed.y + (50 - 100) / zoomed.zoom).toBe(450);
  });

  it('draws overlapping cells in isometric depth order', async () => {
    const sheet = document.createElement('canvas');
    sheet.width = 128; sheet.height = 128;
    const sheetContext = sheet.getContext('2d')!;
    sheetContext.fillStyle = '#ff0000'; sheetContext.fillRect(0, 0, 64, 128);
    sheetContext.fillStyle = '#0000ff'; sheetContext.fillRect(64, 0, 64, 128);
    const bitmap = await createImageBitmap(sheet);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 192; canvas.height = 256;
      const context = canvas.getContext('2d')!;
      const images = new Map<number, TilezedImage>([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]);
      drawTilezedScene(context, sceneFor(2, 1, new Uint32Array([1, 2])), images,
        { x: 48, y: 0, zoom: 1 }, { width: 192, height: 256 }, 1);
      expect(Array.from(context.getImageData(53, 128, 1, 1).data)).toEqual([255, 0, 0, 255]);
      expect(Array.from(context.getImageData(88, 128, 1, 1).data)).toEqual([0, 0, 255, 255]);
    } finally { bitmap.close(); }
  });

  it('only traverses visible cells when zoomed into a large map', async () => {
    const sheet = document.createElement('canvas');
    sheet.width = 128; sheet.height = 128;
    const bitmap = await createImageBitmap(sheet);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const context = canvas.getContext('2d')!;
      const draw = spyOn(context, 'drawImage').and.callThrough();
      const images = new Map<number, TilezedImage>([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]);
      drawTilezedScene(context, sceneFor(300, 300, new Uint32Array(90000).fill(1)), images,
        { x: 9600, y: 4800, zoom: 1 }, { width: 128, height: 128 }, 1);
      expect(draw.calls.count()).toBeGreaterThan(0);
      expect(draw.calls.count()).toBeLessThan(200);
    } finally { bitmap.close(); }
  });

  it('renders available tiles while skipping references outside the actual sheet image', async () => {
    const sheet = document.createElement('canvas'); sheet.width = 128; sheet.height = 128;
    sheet.getContext('2d')!.fillStyle = '#ff0000'; sheet.getContext('2d')!.fillRect(0, 0, 64, 128);
    const bitmap = await createImageBitmap(sheet);
    try {
      const scene = sceneFor(2, 1, Uint32Array.of(1, 3));
      scene.map.tilesets = [{ ...tileset, rows: 2, imageHeight: 256 }];
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 256;
      const context = canvas.getContext('2d')!;
      const draw = spyOn(context, 'drawImage').and.callThrough();
      drawTilezedScene(context, scene, new Map([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]),
        { x: 48, y: 0, zoom: 1 }, { width: 192, height: 256 }, 1);
      expect(draw).toHaveBeenCalledTimes(1);
      expect(Array.from(context.getImageData(53, 128, 1, 1).data)).toEqual([255, 0, 0, 255]);
    } finally { bitmap.close(); }
  });

  it('previews the stamp at placement coordinates with transparency and restores the canvas state', async () => {
    const sheet = document.createElement('canvas'); sheet.width = 128; sheet.height = 128;
    const bitmap = await createImageBitmap(sheet);
    try {
      const scene = sceneFor(4, 1, new Uint32Array(4));
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      context.globalAlpha = 0.8;
      const alphas: number[] = [];
      const draw = spyOn(context, 'drawImage').and.callFake(() => { alphas.push(context.globalAlpha); });
      drawTilezedStamp(context, scene.map, new Map([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]),
        { width: 2, height: 1, gids: Uint32Array.of(1, 2) }, { x: 1, y: 0 });
      expect(draw.calls.allArgs()).toEqual([
        [bitmap, 0, 0, 64, 128, 32, -80, 64, 128],
        [bitmap, 64, 0, 64, 128, 64, -64, 64, 128],
      ]);
      expect(alphas).toEqual([0.65, 0.65]);
      expect(context.globalAlpha).toBeCloseTo(0.8);
      expect(Array.from(scene.layers[0].gids)).toEqual([0,0,0,0]);
    } finally { bitmap.close(); }
  });

  it('clips preview tiles to the map and selection, and skips empty or unavailable stamp tiles', async () => {
    const sheet = document.createElement('canvas'); sheet.width = 128; sheet.height = 128;
    const bitmap = await createImageBitmap(sheet);
    try {
      const scene = sceneFor(2, 2, new Uint32Array(4));
      scene.map.tilesets = [{ ...tileset, rows: 2, imageHeight: 256 }];
      const context = document.createElement('canvas').getContext('2d')!;
      const draw = spyOn(context, 'drawImage');
      const images = new Map([[1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } }]]);
      const stamp = { width: 2, height: 2, gids: Uint32Array.of(1, 0, 2, 3) };
      drawTilezedStamp(context, scene.map, images, stamp, { x: 0, y: 0 });
      expect(draw).toHaveBeenCalledTimes(2);
      draw.calls.reset();
      drawTilezedStamp(context, scene.map, images, stamp, { x: 1, y: 1 });
      expect(draw).toHaveBeenCalledTimes(1);
      draw.calls.reset();
      drawTilezedStamp(context, scene.map, images, stamp, { x: 0, y: 0 }, { x: 1, y: 0, width: 1, height: 2 });
      expect(draw).not.toHaveBeenCalled();
    } finally { bitmap.close(); }
  });
});
