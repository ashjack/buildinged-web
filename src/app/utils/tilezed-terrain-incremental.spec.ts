import { generateTilezedScene, TilezedTerrainUpdater } from './tilezed-terrain';
import { TilezedMap, TilezedDirection } from './tilezed-map';

describe('Incremental TileZed terrain', () => {
  function map(): TilezedMap {
    const width = 47, height = 39, count = width * height;
    return { width, height, tileWidth: 64, tileHeight: 32,
      tilesets: [{ firstGid: 1, name: 'ground', source: '', tileWidth: 64, tileHeight: 128, imageWidth: 512, imageHeight: 128, columns: 8, rows: 1 }],
      layers: ['0_Floor', '0_FloorOverlay', '0_Vegetation', '0_Unrelated'].map((name, layer) => ({ name, visible: true, opacity: 1,
        gids: Uint32Array.from({ length: count }, (_, i) => layer === 0 ? i % 3 ? 1 : 2 : layer === 3 && i % 13 === 0 ? 6 : 0) })),
      bitmaps: new Map([0, 1].map(index => [index, { seed: index ? 0xffffffff : 13945,
        pixels: Uint32Array.from({ length: count }, (_, i) => index ? i % 5 ? 0 : 0x00ff00 : i % 7 ? i % 3 ? 0x140000 : 0x0a0000 : 0) }])),
      aliases: new Map([['grass', ['ground_001', 'ground_002', 'ground_003']]]),
      rules: [
        { bitmap: 0, color: 0x0a0000, condition: 0, layer: '0_Floor', choices: ['grass'] },
        { bitmap: 0, color: 0x140000, condition: 0, layer: '0_Floor', choices: ['ground_000'] },
        { bitmap: 1, color: 0x00ff00, condition: 0x0a0000, layer: '0_Vegetation', choices: ['ground_004', 'ground_005', 'null'] },
      ],
      blends: (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as TilezedDirection[]).map(direction => ({ layer: '0_FloorOverlay', main: 'grass', tile: 'ground_006', direction,
        excluded: ['ground_007'], excludedLayers: [{ layer: '0_Unrelated', tile: 'ground_005' }] })),
      noBlend: new Map([['0_FloorOverlay', Uint8Array.from({ length: count }, (_, i) => i % 19 === 0 ? 1 : 0)]]),
      warnings: [], blendEdgesEverywhere: false,
    };
  }
  for (const everywhere of [false, true]) it(`matches full regeneration across edits, edges, conditions, seeds and blend masks (edges everywhere: ${everywhere})`, () => {
    const source = map(); source.blendEdgesEverywhere = everywhere;
    const scene = generateTilezedScene(source), updater = new TilezedTerrainUpdater();
    let random = 29;
    for (let step = 0; step < 50; step++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const x = step < 4 ? step % 2 ? source.width - 1 : 0 : random % source.width;
      const y = step < 4 ? step < 2 ? 0 : source.height - 1 : (random >>> 8) % source.height;
      const index = y * source.width + x;
      source.bitmaps.get(0)!.pixels[index] = [0, 0x0a0000, 0x140000][step % 3];
      source.bitmaps.get(1)!.pixels[index] = step % 2 ? 0 : 0x00ff00;
      source.layers[0].gids[index] = step % 3 ? 2 : 1;
      source.noBlend!.get('0_FloorOverlay')![index] ^= 1;
      updater.update(scene, { x, y, width: 1, height: 1 });
      const full = generateTilezedScene(source);
      full.layers.forEach((layer, i) => expect([...scene.layers[i].gids]).withContext(`step ${step}, ${layer.name}`).toEqual([...layer.gids]));
    }
  });
  it('updates small brush regions in place and keeps distant tile data and palette coverage', () => {
    const source = map(), scene = generateTilezedScene(source), layer = scene.layers[0], array = layer.gids, updater = new TilezedTerrainUpdater();
    source.bitmaps.get(0)!.pixels[0] = 0x0a0000;
    const region = updater.update(scene, { x: 0, y: 0, width: 1, height: 1 });
    expect(region).toEqual({ x: 0, y: 0, width: 3, height: 3 }); expect(scene.layers[0]).toBe(layer); expect(scene.layers[0].gids).toBe(array);
    expect([...scene.layers[0].gids]).toEqual([...generateTilezedScene(source).layers[0].gids]);
  });
  it('matches full generation with hidden generated/raw/overlay display options', () => {
    for (const display of [{ bmp: false, map: true, overlays: true }, { bmp: true, map: false, overlays: false }, { bmp: false, map: false, overlays: true }]) {
      const source = map(), scene = generateTilezedScene(source, display), updater = new TilezedTerrainUpdater();
      source.bitmaps.get(0)!.pixels[100] = 0x0a0000; source.layers[0].gids[100] = 8;
      updater.update(scene, { x: 100 % source.width, y: Math.floor(100 / source.width), width: 1, height: 1 }, display);
      const full = generateTilezedScene(source, display);
      full.layers.forEach((layer, i) => { expect([...scene.layers[i].gids]).toEqual([...layer.gids]); expect(scene.layers[i].visible).toBe(layer.visible); });
    }
  });
  it('uses full regeneration for large fills and floor-targeting blends', () => {
    const source = map(), scene = generateTilezedScene(source), updater = new TilezedTerrainUpdater();
    source.blends[0].layer = '0_Floor'; source.bitmaps.get(0)!.pixels[100] = 0x0a0000;
    expect(updater.update(scene, { x: 6, y: 2, width: 1, height: 1 })).toEqual({ x: 0, y: 0, width: 47, height: 39 });
    expect(scene.layers).toEqual(generateTilezedScene(source).layers);
  });
});
