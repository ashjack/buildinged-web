import { readTilezedMap, TilezedDirection, TilezedMap } from './tilezed-map';
import { generateTilezedScene } from './tilezed-terrain';

async function encode(values: number[], format: 'deflate' | 'gzip'): Promise<string> {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(String.fromCharCode(...compressed));
}

async function fixture(exclude = true): Promise<string> {
  const empty = await encode(Array(9).fill(0), 'deflate');
  const floor = await encode([0, 0, 0, 0, 4, 0, 0, 0, 0], 'deflate');
  const otherOverlay = await encode([0, 0, 0, 0, 5, 0, 0, 0, 0], 'deflate');
  const ground = await encode([2, 1, 2, 2, 2, 1, 2, 2, 2], 'gzip');
  const vegetation = await encode([0, 1, 0, 0, 1, 1, 0, 0, 0], 'gzip');
  return `<map version="1.0" orientation="levelisometric" width="3" height="3" tilewidth="64" tileheight="32">
    <tileset firstgid="1" name="ground_01" tilewidth="64" tileheight="128"><image source="ground_01.png" width="512" height="128"/></tileset>
    <tileset firstgid="9" name="veg_01" tilewidth="64" tileheight="128"><image source="veg_01.png" width="512" height="128"/></tileset>
    <layer name="0_Floor" width="3" height="3"><data encoding="base64" compression="zlib">${floor}</data></layer>
    <layer name="0_FloorOverlay" width="3" height="3"><data encoding="base64" compression="zlib">${empty}</data></layer>
    <layer name="0_FloorOverlay2" width="3" height="3"><data encoding="base64" compression="zlib">${otherOverlay}</data></layer>
    <layer name="0_Vegetation" width="3" height="3"><data encoding="base64" compression="zlib">${empty}</data></layer>
    <objectgroup name="0_Lots"/>
    <bmp-settings>
      <aliases><alias name="red" tiles="ground_01_001"/><alias name="blue" tiles="ground_01_000"/></aliases>
      <rules>
        <rule bitmapIndex="0" color="10 0 0" targetLayer="0_Floor" condition="0 0 0" tileChoices="red"/>
        <rule bitmapIndex="0" color="20 0 0" targetLayer="0_Floor" condition="0 0 0" tileChoices="blue"/>
        <rule bitmapIndex="1" color="0 255 0" targetLayer="0_Vegetation" condition="10 0 0" tileChoices="veg_01_000 veg_01_001"/>
      </rules>
      <blends>
        <blend targetLayer="0_FloorOverlay" mainTile="red" blendTile="ground_01_002" dir="ne" ExclusionList="" exclude2=""/>
        <blend targetLayer="0_FloorOverlay" mainTile="red" blendTile="ground_01_003" dir="ne" ExclusionList=""
               exclude2="${exclude ? 'ground_01_004 0_FloorOverlay2' : ''}"/>
      </blends>
    </bmp-settings>
    <bmp-image index="0" seed="1"><color rgb="10 0 0"/><color rgb="20 0 0"/><pixels>${ground}</pixels></bmp-image>
    <bmp-image index="1" seed="1"><color rgb="0 255 0"/><pixels>${vegetation}</pixels></bmp-image>
  </map>`;
}

describe('TileZed TMX terrain', () => {
  it('reads visible native lot references in tile coordinates and preserves their level', async () => {
    const xml = (await fixture()).replace('<objectgroup name="0_Lots"/>', `<objectgroup name="2_Lots">
      <object name="lot" type="../Buildings/house.tbx" x="64" y="96" width="128" height="160"/>
      <object name="lot" type="hidden.tbx" visible="0" x="0" y="0"/>
    </objectgroup>`);
    const map = await readTilezedMap(xml);
    expect(map.lots).toEqual([{ map: '../Buildings/house.tbx', x: 2, y: 3, width: 4, height: 5, level: 2 }]);
    expect(map.warnings).not.toContain('Objects, lots, image layers, and layer groups are not shown in this viewer.');
  });

  it('decodes compressed layers and BMP palettes and applies ground and conditional vegetation', async () => {
    const map = await readTilezedMap(await fixture());
    const scene = generateTilezedScene(map);
    expect(map.layers[0].gids[4]).toBe(4);
    expect(Array.from(scene.layers[0].gids)).toEqual([1, 2, 1, 1, 1, 2, 1, 1, 1]);
    expect(scene.layers[3].gids[1]).toBeGreaterThanOrEqual(9);
    expect(scene.layers[3].gids[5]).toBeGreaterThanOrEqual(9);
    expect(scene.layers[3].gids[4]).toBe(0);
    expect(scene.layers[3].gids.filter(gid => gid !== 0).length).toBe(2);
    expect(scene.usedSheets.map(item => item.tileset.name)).toEqual(['ground_01', 'veg_01']);
    expect(map.layers[0].gids[4]).toBe(4);
  });

  it('uses the last matching edge blend and honors exclusions from stored layers', async () => {
    const excluded = generateTilezedScene(await readTilezedMap(await fixture(true)));
    const included = generateTilezedScene(await readTilezedMap(await fixture(false)));
    expect(excluded.layers[1].gids[4]).toBe(0);
    expect(included.layers[1].gids[4]).toBe(4);
  });

  it('uses the correct neighboring cells for all eight blend directions', () => {
    const directions: [TilezedDirection, number[]][] = [
      ['n', [1]], ['s', [7]], ['e', [5]], ['w', [3]],
      ['ne', [1, 5]], ['nw', [1, 3]], ['se', [7, 5]], ['sw', [7, 3]],
    ];
    for (const [direction, neighbors] of directions) {
      const pixels = new Uint32Array(9).fill(20);
      neighbors.forEach(index => pixels[index] = 10);
      const map: TilezedMap = {
        width: 3, height: 3, tileWidth: 64, tileHeight: 32,
        tilesets: [{
          name: 'ground_01', source: 'ground_01.png', firstGid: 1, tileWidth: 64, tileHeight: 128,
          imageWidth: 192, imageHeight: 128, columns: 3, rows: 1,
        }],
        layers: [
          { name: '0_Floor', gids: new Uint32Array(9), visible: true, opacity: 1 },
          { name: '0_FloorOverlay', gids: new Uint32Array(9), visible: true, opacity: 1 },
        ],
        bitmaps: new Map([[0, { seed: 1, pixels }]]),
        aliases: new Map(),
        rules: [
          { bitmap: 0, color: 10, condition: 0, layer: '0_Floor', choices: ['ground_01_001'] },
          { bitmap: 0, color: 20, condition: 0, layer: '0_Floor', choices: ['ground_01_000'] },
        ],
        blends: [{
          layer: '0_FloorOverlay', main: 'ground_01_001', tile: 'ground_01_002',
          direction, excluded: [], excludedLayers: [],
        }],
        blendEdgesEverywhere: false, warnings: [],
      };
      expect(generateTilezedScene(map).layers[1].gids[4]).withContext(direction).toBe(3);
      if (direction === 'n') {
        pixels[5] = 10;
        expect(generateTilezedScene(map).layers[1].gids[4]).toBe(0);
      }
    }
  });

  it('accepts sheets with unused pixels beyond their complete tile grid', async () => {
    const xml = (await fixture()).replace('width="512" height="128"', 'width="519" height="135"');
    const map = await readTilezedMap(xml);
    expect(map.tilesets[0].columns).toBe(8);
    expect(map.tilesets[0].rows).toBe(1);
    expect(map.tilesets[0].imageWidth).toBe(519);
  });

  it('reports invalid maps, corrupt data and unsupported tiles instead of showing an empty map', async () => {
    await expectAsync(readTilezedMap('<map>')).toBeRejectedWithError(/valid XML/);
    await expectAsync(readTilezedMap('<map orientation="orthogonal"/>')).toBeRejectedWithError(/level-isometric/);
    const xml = await fixture();
    await expectAsync(readTilezedMap(xml.replace('compression="zlib"', 'compression="unsupported"')))
      .toBeRejectedWithError(/unsupported compression/);
    const flipped = await encode([0x80000001, 0, 0, 0, 0, 0, 0, 0, 0], 'deflate');
    await expectAsync(readTilezedMap(xml.replace(/(<layer name="0_Floor"[^>]*><data[^>]*>)[^<]+/, `$1${flipped}`)))
      .toBeRejectedWithError(/Flipped tiles/);
  });

  it('warns about nonblack BMP colors with no rule and does not change the stored layers', async () => {
    const xml = (await fixture()).replace('<color rgb="0 255 0"/>', '<color rgb="0 128 0"/>');
    const map = await readTilezedMap(xml);
    const scene = generateTilezedScene(map);
    expect(scene.warnings).toContain('Vegetation BMP: 3 pixels have no rule for #008000.');
    expect(scene.layers[3].gids.every(gid => gid === 0)).toBeTrue();
    expect(map.layers[0].gids[4]).toBe(4);
  });

  it('reports unresolved blend tiles rather than silently dropping the blend', async () => {
    const xml = (await fixture()).replace('blendTile="ground_01_002"', 'blendTile="missing_01_002"');
    const scene = generateTilezedScene(await readTilezedMap(xml));
    expect(scene.warnings).toContain('BMP blend for 0_FloorOverlay references unknown tiles: missing_01_002.');
  });
});
