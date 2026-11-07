import { SvgTile } from '../models/app.models';
import {
  BuildingSprite, buildingPixelBounds, buildingPreviewTiles, buildingSquareBounds, drawBuildingSprites, orderTilezedBuildingSprites,
  placeBuildingSprite, prepareBuildingTiles,
} from './building-preview';
import { readBuildingPreviewFile } from './tbx-format';
import { emptyIndexGrid, writeIndexGrid } from './tbx-grid';

describe('Building thumbnail projection and culling', () => {
  const tile = (x: number, y: number, level: number, layer = 'Floor'): SvgTile =>
    ({ x, y, level, layer, name: 'walls_exterior_01_001.png', url: '' });
  const sprite = (minX: number, minY: number, maxX: number, maxY: number, level = 0, name = ''): BuildingSprite =>
    ({ bitmap: { name } as unknown as ImageBitmap, level, squares: { minX, minY, maxX, maxY }, bounds: {
      left: (minX - maxY) * 32 - 32, right: (maxX - minY) * 32 + 32,
      top: (minX + minY) * 16 - level * 96 - 400, bottom: (maxX + maxY) * 16 + 32,
    } });
  const order = (sprites: BuildingSprite[]) => orderTilezedBuildingSprites(sprites).sprites;

  it('merges manual tiles by square, layer and level, including the extra border', () => {
    const b = readBuildingPreviewFile(new DOMParser().parseFromString(`<building version="3" width="1" height="1">
      <tile_entry category="floors"><tile enum="Floor" tile="floors_01_0"/></tile_entry>
      <room Name="Room" Floor="1"/><floor><rooms>1</rooms></floor><floor><rooms>1</rooms></floor>
    </building>`, 'text/xml'));
    b.user_tiles = [{ tile: 'floors_01_1' }, { tile: 'roofs_01_11' }, { tile: 'roofs_01_12' }];
    const floor = emptyIndexGrid(2, 2), roof = emptyIndexGrid(2, 2), roof2 = emptyIndexGrid(2, 2);
    floor[0][0] = 1;
    roof[1][1] = 2;
    roof2[1][1] = 3;
    b.floors[0].tileLayers = [
      { layer: 'Floor', tiles: writeIndexGrid(floor) },
      { layer: 'Roof', tiles: writeIndexGrid(roof) },
      { layer: 'Roof2', tiles: writeIndexGrid(roof2) },
    ];
    const tiles = buildingPreviewTiles(b);
    expect(tiles.filter(t => t.layer === 'Floor').map(t => [t.level, t.name]))
      .toEqual([[0, 'floors_01_1.png'], [1, 'floors_01_0.png']]);
    expect(tiles.filter(t => t.layer.startsWith('Roof')).map(t => [t.x, t.y, t.layer, t.name]))
      .toEqual([[1, 1, 'Roof', 'roofs_01_11.png'], [1, 1, 'Roof2', 'roofs_01_12.png']]);
    expect(buildingSquareBounds(tiles)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(prepareBuildingTiles(tiles, 1).map(t => t.sheet)).toEqual(['floors_01']);
    b.floors[0].tileLayers = [];
    expect(buildingPreviewTiles(b).filter(t => t.level === 0).map(t => t.name)).toEqual(['floors_01_0.png']);
  });

  it('draws neighbouring houses back-to-front along either ground axis, regardless of file order', () => {
    const row = [sprite(5, 240, 13, 257), sprite(5, 222, 13, 239), sprite(5, 204, 13, 221)];
    const column = [sprite(40, 5, 48, 15), sprite(20, 5, 28, 15), sprite(0, 5, 8, 15)];
    for (const input of [row, column]) {
      const original = input.slice();
      const expected = input.slice().reverse();
      expect(order(input)).toEqual(expected);
      expect(order(expected)).toEqual(expected);
      expect(orderTilezedBuildingSprites(input).cyclic).toBeFalse();
      expect(input).toEqual(original);
    }
  });

  it('uses occupied-square separation rather than a single anchor, centre or image-bottom sort', () => {
    const longRear = sprite(0, 0, 99, 3);
    const front = sprite(20, 4, 23, 7);
    // The rear building's centre and far corner are deeper than the front building's.
    expect(order([front, longRear])).toEqual([longRear, front]);
    const longRearY = sprite(0, 0, 3, 99);
    const frontX = sprite(4, 20, 7, 23);
    expect(order([frontX, longRearY])).toEqual([longRearY, frontX]);
  });

  it('orders staggered neighbours that share a wall line', () => {
    // Chinnor's semi-detached rows: lot rectangles overlap, but only the party-wall column is shared.
    const left = sprite(6, 163, 17, 173), middle = sprite(17, 160, 28, 170), right = sprite(28, 163, 39, 173);
    const result = orderTilezedBuildingSprites([right, middle, left]);
    expect(result.sprites).toEqual([left, middle, right]);
    expect(result.cyclic).toBeFalse();
  });

  it('keeps base levels ordered and preserves source order for coincident footprints', () => {
    const upper = sprite(0, 0, 8, 17, 1);
    const lower = sprite(100, 100, 108, 117);
    const same = sprite(100, 100, 108, 117, 0, 'same');
    expect(order([upper, lower, same])).toEqual([lower, same, upper]);
    expect(orderTilezedBuildingSprites([])).toEqual({ sprites: [], cyclic: false });
  });

  it('does not impose conflicting dependencies on lots separated in opposite directions', () => {
    const leftFront = sprite(0, 20, 3, 23);
    const rightRear = sprite(20, 0, 23, 3);
    const result = orderTilezedBuildingSprites([rightRear, leftFront]);
    expect(result.cyclic).toBeFalse();
    expect(result.sprites).toEqual([leftFront, rightRear]);
  });

  it('measures the squares a building draws from its visible tiles', () => {
    const hidden = { ...tile(-5, -5, 0), hidden: true };
    expect(buildingSquareBounds([tile(1, 2, 0), tile(4, 0, 1), tile(9, 9, 0, 'Walls'), hidden]))
      .toEqual({ minX: 1, minY: 0, maxX: 9, maxY: 9 });
    expect(buildingSquareBounds([tile(9, 9, 0), tile(1, 2, 1)], 1)).toEqual({ minX: 1, minY: 2, maxX: 1, maxY: 2 });
    expect(() => buildingSquareBounds([hidden])).toThrowError(/no visible tiles/);
  });

  it('uses native 1x projection, floor lift and layer order', () => {
    const result = prepareBuildingTiles([tile(1, 0, 1), tile(0, 0, 0, 'Walls'), tile(0, 0, 0)]);
    expect(result.map(t => [t.x, t.y])).toEqual([[-32, -96], [-32, -96], [0, -176]]);
    expect(buildingPixelBounds(result)).toEqual({ left: -32, right: 64, top: -176, bottom: 32 });
    expect(prepareBuildingTiles([tile(0, 0, 0), tile(0, 0, 1)], 1).length).toBe(1);
  });

  it('anchors cached image bounds and skips offscreen placements without drawing tiles', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const bitmap = await createImageBitmap(canvas);
    try {
      const context = canvas.getContext('2d')!;
      const draw = spyOn(context, 'drawImage');
      const bounds = { left: -32, right: 32, top: -96, bottom: 32 };
      const squares = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
      const visible = placeBuildingSprite(bitmap, { bounds, squares }, { x: 3, y: 4, level: 0 }, 50, 50, 1);
      const hidden = placeBuildingSprite(bitmap, { bounds, squares }, { x: 0, y: 0, level: 0 }, 10000, 10000, 1);
      expect(visible.bounds.left).toBe(18);
      expect(visible.squares).toEqual({ minX: 3, minY: 4, maxX: 4, maxY: 5 });
      expect(drawBuildingSprites(context, [visible, hidden], { x: 50, y: 50, zoom: 1 },
        { width: 100, height: 100 })).toBe(1);
      expect(draw).toHaveBeenCalledTimes(1);
    } finally { bitmap.close(); }
  });
});
