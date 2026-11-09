import { tilezedFenceCells } from './tilezed-fence';

describe('Native TileZed fence behavior', () => {
  const tiles = new Map([['west1', 1], ['west2', 2], ['north1', 3], ['north2', 4], ['nw', 5], ['post', 6],
    ['gate-space-w', 7], ['gate-space-n', 8], ['gate-door-w', 9], ['gate-door-n', 10]]);
  const plain = { alt: false, ctrl: false };
  it('constrains drags to the dominant axis and alternates pieces in the native direction', () => {
    expect(tilezedFenceCells(tiles, { x: 0.4, y: 0.4 }, { x: 3.4, y: 1.4 }, () => 0, plain))
      .toEqual([0, 1, 2, 3].map((x, i) => ({ point: { x, y: 0 }, gid: i % 2 ? 4 : 3 })));
    expect(tilezedFenceCells(tiles, { x: 0.4, y: 3.4 }, { x: 0.4, y: 0.4 }, () => 0, plain).map(cell => cell.gid))
      .toEqual([2, 1, 2, 1]);
  });
  it('joins a perpendicular fence with a corner and preserves existing corners', () => {
    const result = tilezedFenceCells(tiles, { x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }, point => point.x === 0 ? 1 : point.x === 1 ? 5 : 0, plain);
    expect(result).toEqual([{ point: { x: 0, y: 0 }, gid: 5 }, { point: { x: 2, y: 0 }, gid: 3 }]);
  });
  it('joins either alternating piece from either direction, for forward and reverse drags', () => {
    for (const north of [false, true]) for (const reverse of [false, true]) for (const second of [false, true]) {
      const existing = tiles.get(`${north ? 'west' : 'north'}${second ? 2 : 1}`)!;
      const start = north ? { x: reverse ? 2.5 : 0.5, y: 1.5 } : { x: 1.5, y: reverse ? 2.5 : 0.5 };
      const end = north ? { x: reverse ? 0.5 : 2.5, y: 1.5 } : { x: 1.5, y: reverse ? 0.5 : 2.5 };
      const result = tilezedFenceCells(tiles, start, end, point => point.x === 1 && point.y === 1 ? existing : 0, plain);
      expect(result.find(cell => cell.point.x === 1 && cell.point.y === 1)?.gid).toBe(5);
    }
  });
  it('joins the second alternating piece in a hover preview and preserves a completed corner', () => {
    expect(tilezedFenceCells(tiles, { x: 0.1, y: 0.5 }, undefined, () => 4, plain))
      .toEqual([{ point: { x: 0, y: 0 }, gid: 5 }]);
    expect(tilezedFenceCells(tiles, { x: 0.5, y: 0.1 }, undefined, () => 2, plain))
      .toEqual([{ point: { x: 0, y: 0 }, gid: 5 }]);
    expect(tilezedFenceCells(tiles, { x: 0.5, y: 0.1 }, undefined, () => 5, plain)).toEqual([]);
  });
  it('preserves existing parallel sections and special fence pieces when extending or retracing a run', () => {
    for (const north of [false, true]) {
      const existing = [tiles.get(north ? 'north2' : 'west2')!, 5, 6, 7, 8, 9, 10];
      const start = { x: 0.5, y: 0.5 }, end = north ? { x: 7.5, y: 0.5 } : { x: 0.5, y: 7.5 };
      const result = tilezedFenceCells(tiles, start, end, point => existing[north ? point.x : point.y] ?? 0, plain);
      expect(result).toEqual([{ point: north ? { x: 7, y: 0 } : { x: 0, y: 7 }, gid: north ? 4 : 2 }]);
    }
  });
  it('keeps a perpendicular section when the preset has no corner tile', () => {
    const withoutCorner = new Map(tiles); withoutCorner.delete('nw');
    expect(tilezedFenceCells(withoutCorner, { x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, () => 2, plain)).toEqual([]);
  });
  it('uses the clicked edge for standalone gates and inserts gate spaces into existing fences', () => {
    const alt = { alt: true, ctrl: false }, point = { x: 0.1, y: 0.5 };
    expect(tilezedFenceCells(tiles, point, undefined, () => 0, alt)[0].gid).toBe(9);
    expect(tilezedFenceCells(tiles, point, undefined, () => 3, alt)[0].gid).toBe(8);
    expect(tilezedFenceCells(tiles, point, undefined, () => 2, alt)[0].gid).toBe(7);
  });
  it('toggles posts and skips optional shapes absent from a preset', () => {
    const ctrl = { alt: false, ctrl: true }, point = { x: 1.2, y: 2.3 };
    expect(tilezedFenceCells(tiles, point, undefined, () => 0, ctrl)[0].gid).toBe(6);
    expect(tilezedFenceCells(tiles, point, undefined, () => 6, ctrl)[0].gid).toBe(0);
    expect(tilezedFenceCells(new Map(), point, undefined, () => 0, ctrl)).toEqual([]);
  });
});
