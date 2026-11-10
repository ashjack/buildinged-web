import { BuildingSprite } from './building-preview';
import { drawTilezedComposition, lotLayerSuppressesLayer, pickTilezedComposition, tilezedComposition } from './tilezed-composition';
import { TilezedScene } from './tilezed-terrain';

describe('Native TileZed square composition', () => {
  let red: ImageBitmap, blue: ImageBitmap, green: ImageBitmap;
  const camera = { x: 48, y: 0, zoom: 1 }, viewport = { width: 192, height: 256 };
  beforeEach(async () => {
    const bitmap = async (color: string) => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
      const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 64, 128);
      return createImageBitmap(canvas);
    };
    [red, blue, green] = await Promise.all([bitmap('#ff0000'), bitmap('#0000ff'), bitmap('#00ff00')]);
  });
  afterEach(() => { red.close(); blue.close(); green.close(); });
  function scene(aboveX = 0): TilezedScene {
    const map: TilezedScene['map'] = { width: 2, height: 1, tileWidth: 64, tileHeight: 32,
      tilesets: [1, 2].map(firstGid => ({ firstGid, name: String(firstGid), source: '', tileWidth: 64, tileHeight: 128,
        columns: 1, rows: 1, imageWidth: 64, imageHeight: 128 })),
      layers: [
        { name: '0_AboveLots', gids: Uint32Array.from([0, 1].map(x => x === aboveX ? 2 : 0)), visible: true, opacity: 1 },
        { name: '0_Floor', gids: Uint32Array.of(1, 1), visible: true, opacity: 1 },
      ], bitmaps: new Map(), aliases: new Map(), rules: [], blends: [], blendEdgesEverywhere: false, warnings: [] };
    return { map, layers: map.layers, usedSheets: [], warnings: [] };
  }
  function building(x: number, level = 0, layer = 'Walls'): BuildingSprite {
    return { bitmap: green, level, squares: { minX: x, minY: 0, maxX: x, maxY: 0 },
      bounds: { left: x * 32, right: x * 32 + 64, top: -96, bottom: 48 },
      composition: { x, y: 0, level, pages: [green], tiles: [
        { squareX: 0, squareY: 0, level: 0, layer, sheet: 'building', index: 7, frame: 0 },
      ] } };
  }
  function render(current: TilezedScene, buildings: BuildingSprite[]) {
    const images = new Map([[1, { bitmap: red, layout: { tileWidth: 64, tileHeight: 128 } }],
      [2, { bitmap: blue, layout: { tileWidth: 64, tileHeight: 128 } }]]);
    const commands = tilezedComposition(current, images, buildings, camera, viewport);
    const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
    const context = canvas.getContext('2d')!; drawTilezedComposition(context, commands, camera, viewport, 1);
    const pixel = (x: number, y: number) => [...context.getImageData(x - camera.x + viewport.width / 2, y - camera.y + viewport.height / 2, 1, 1).data];
    return { commands, pixel };
  }
  it('allows a nearer building wall to cover a farther AboveLots fence and picks the visible wall', () => {
    const result = render(scene(0), [building(1)]);
    expect(result.pixel(40, -40)).toEqual([0, 255, 0, 255]);
    expect(pickTilezedComposition(result.commands, 40, -40)?.sheet).toBe('building');
  });
  it('draws AboveLots after a lot at the same square and respects depth from neighboring squares', () => {
    const same = render(scene(0), [building(0)]);
    expect(same.pixel(10, -40)).toEqual([0, 0, 255, 255]);
    expect(pickTilezedComposition(same.commands, 10, -40)?.layer).toBe('0_AboveLots');
    const nearerFence = render(scene(1), [building(0)]);
    expect(nearerFence.pixel(40, -40)).toEqual([0, 0, 255, 255]);
    const nearerVegetation = scene(0);
    nearerVegetation.layers.push({ name: '0_Vegetation', gids: Uint32Array.of(0, 1), visible: true, opacity: 1 });
    expect(render(nearerVegetation, []).pixel(40, -40)).toEqual([255, 0, 0, 255]);
  });
  it('renders higher building levels after ground AboveLots and never promotes hidden special layers', () => {
    expect(render(scene(0), [building(0, 1, 'Roof')]).pixel(10, -80)).toEqual([0, 255, 0, 255]);
    const hidden = scene(0); hidden.layers[0].visible = false;
    hidden.layers.push({ name: '0_Vegetation', gids: Uint32Array.of(1, 0), visible: true, opacity: 1 });
    expect(render(hidden, [building(0)]).pixel(10, -40)).toEqual([0, 255, 0, 255]);
  });
  it('matches native floor, vegetation and same-layer suppression without removing AboveLots', () => {
    for (const layer of ['Walls', 'Walls2', 'WallTrim', 'WallOverlay', 'WallGrime', 'Frames', 'Doors', 'Windows'])
      expect(lotLayerSuppressesLayer(layer, 'Vegetation')).toBeFalse();
    for (const layer of ['Floor', 'Furniture', 'FloorFurniture', 'WallFurniture'])
      expect(lotLayerSuppressesLayer(layer, 'Vegetation2')).toBeTrue();
    expect(lotLayerSuppressesLayer('Furniture', 'Furniture')).toBeTrue();
    const current = scene(0);
    current.layers.push({ name: '0_Vegetation', gids: Uint32Array.of(1, 0), visible: true, opacity: 1 });
    const result = render(current, [building(0, 0, 'Floor')]);
    const sameSquare = result.commands.filter(draw => draw.x === 0);
    expect(sameSquare.map(draw => draw.layer)).toEqual(['Floor', '0_AboveLots']);
  });
  it('uses atlas frame coordinates and native scale when building tile images are not whole previews', () => {
    const lot = building(1); lot.composition!.tiles[0].frame = 256;
    lot.composition!.pages.push(green);
    expect(render(scene(0), [lot]).pixel(40, -40)).toEqual([0, 255, 0, 255]);
  });
  it('draws a shared source tile from its own image instead of using its previous atlas offset', () => {
    const lot = building(1); lot.composition!.tiles[0].frame = 259;
    lot.composition!.pages = []; lot.composition!.frames = new Map([[259, green]]);
    const result = render(scene(0), [lot]);
    expect(result.pixel(40, -40)).toEqual([0, 255, 0, 255]);
    expect(pickTilezedComposition(result.commands, 40, -40)?.sheet).toBe('building');
  });
});
