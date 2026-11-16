import { drawTilezedTerrainRegion } from './tilezed-terrain-render';
import { drawTilezedComposition, tilezedComposition } from './tilezed-composition';
import { generateTilezedScene } from './tilezed-terrain';
import { TilezedMap } from './tilezed-map';
import { BuildingSprite } from './building-preview';
import { TilezedImage } from './tilezed-renderer';

describe('Partial terrain canvas redraw', () => {
  for (const ratio of [1, 2]) for (const zoom of [0.35, 1.37]) it(`matches a complete redraw through additions, erasing, offsets and buildings (${ratio}x, zoom ${zoom})`, async () => {
    const viewport = { width: 540, height: 370 }, camera = { x: 1280, y: 300, zoom };
    const make = async (width: number, height: number, color: string) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
      ctx.clearRect(3, 3, 10, 16); return createImageBitmap(canvas);
    };
    const [floor, tree, building] = await Promise.all([make(64, 128, '#a68c47'), make(128, 256, '#296f4190'), make(64, 128, '#d2343480')]);
    try {
      const map: TilezedMap = { width: 40, height: 40, tileWidth: 64, tileHeight: 32,
        tilesets: [
          { firstGid: 1, name: 'floor', source: '', tileWidth: 64, tileHeight: 128, columns: 1, rows: 1, imageWidth: 64, imageHeight: 128 },
          { firstGid: 2, name: 'tree', source: '', tileWidth: 128, tileHeight: 256, columns: 1, rows: 1, imageWidth: 128, imageHeight: 256, offsetX: -160, offsetY: 45 },
        ], layers: [
          { name: '0_Floor', gids: new Uint32Array(1600).fill(1), visible: true, opacity: 0.7 },
          { name: '0_Vegetation', gids: Uint32Array.from({ length: 1600 }, (_, i) => i % 7 ? 0 : 2), visible: true, opacity: 0.8 },
          { name: '0_AboveLots', gids: new Uint32Array(1600), visible: true, opacity: 0.6 },
        ], bitmaps: new Map(), rules: [], blends: [], aliases: new Map(), blendEdgesEverywhere: false, noBlend: new Map(), warnings: [] };
      const images = new Map<number, TilezedImage>([[1, { bitmap: floor, layout: { tileWidth: 64, tileHeight: 128 } }],
        [2, { bitmap: tree, layout: { tileWidth: 128, tileHeight: 256 } }]]);
      const lots: BuildingSprite[] = [{ bitmap: building, level: 0, bounds: { left: 608, top: 128, right: 672, bottom: 256 },
        squares: { minX: 7, maxX: 7, minY: 7, maxY: 7 }, composition: { x: 7, y: 7, level: 0, pages: [building], tiles: [
          { squareX: 0, squareY: 0, level: 0, frame: 0, sheet: 'building', index: 0, layer: 'Walls' },
        ] } }];
      lots.push({ ...lots[0], composition: { ...lots[0].composition!, x: 22, y: 22,
        tiles: [{ ...lots[0].composition!.tiles[0], layer: 'Floor' }] } });
      map.layers[1].gids[22 * 40 + 22] = 2;
      const canvas = document.createElement('canvas'); canvas.width = viewport.width * ratio; canvas.height = viewport.height * ratio;
      const expected = canvas.cloneNode() as HTMLCanvasElement, actualCtx = canvas.getContext('2d', { willReadFrequently: true })!, expectedCtx = expected.getContext('2d', { willReadFrequently: true })!;
      const full = (ctx: CanvasRenderingContext2D) => {
        const scene = generateTilezedScene(map); drawTilezedComposition(ctx, tilezedComposition(scene, images, lots, camera, viewport), camera, viewport, ratio);
      };
      full(actualCtx);
      for (let step = 0; step < 4; step++) {
        map.layers[step % 2 ? 1 : 2].gids[7 * 40 + 7] = step < 2 ? 2 : 0;
        map.layers[0].gids[8 * 40 + 8] = step % 2 ? 1 : 0;
        const commands = drawTilezedTerrainRegion(actualCtx, generateTilezedScene(map), images, lots,
          { x: 7, y: 7, width: 2, height: 2 }, camera, viewport, ratio);
        full(expectedCtx);
        expect(actualCtx.getImageData(0, 0, canvas.width, canvas.height).data).withContext(`edit ${step}, ${commands.length} commands`).toEqual(expectedCtx.getImageData(0, 0, canvas.width, canvas.height).data);
      }
      const before = actualCtx.getImageData(0, 0, canvas.width, canvas.height).data;
      expect(drawTilezedTerrainRegion(actualCtx, generateTilezedScene(map), images, [], { x: -1000, y: -1000, width: 1, height: 1 }, camera, viewport, ratio)).toEqual([]);
      expect(actualCtx.getImageData(0, 0, canvas.width, canvas.height).data).toEqual(before);
    } finally { floor.close(); tree.close(); building.close(); }
  });
});
