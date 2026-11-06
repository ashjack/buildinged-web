import { TilezedRandom, tilezedRandomGrid } from './tilezed-random';

describe('TileZed seeded random numbers', () => {
  it('matches QRandomGenerator for several seeds', () => {
    const expected = new Map<number, number[]>([
      [0, [1529278401, 1377812627, 18815962, 2197268577, 328296240]],
      [1, [853323747, 2396352728, 3025954838, 2985633182, 2815751046]],
      [123, [2354714734, 479867775, 1652550580, 3578899409, 3437118842]],
    ]);
    for (const [seed, values] of expected) {
      const random = new TilezedRandom(seed);
      expect(values.map(() => random.next())).toEqual(values);
    }
  });

  it('fills map positions in TileZed column order', () => {
    const grid = tilezedRandomGrid(300, 300, 1);
    expect(grid[0]).toBe(853323747);
    expect(grid[299 * 300]).toBe(3288936303);
    expect(grid[1]).toBe(2234039385);
    expect(grid[89999]).toBe(3111673138);
  });
});
