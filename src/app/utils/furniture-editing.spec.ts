import { BFurniture, BFurnitureGroup } from '../models/furniture-window.models';
import {
  clearEntry, dropTiles, entrySize, fillSequential, SEQUENCES, move, orientsOf, setGrime, setLayer, setTile, tileAt, toggleCorners, updateFurniture,
  validCategoryLabel,
} from './furniture-editing';

describe('furniture editing', () => {
  const chair: BFurniture = { entries: [{ orient: 'W', items: [{ pos: '0,0', tile: 'chair_0' }] }] };

  it('grows the grid to the furthest tile and shrinks it again when that tile is cleared', () => {
    let item = setTile(chair, 'W', 1, 2, 'chair_1');
    expect(entrySize(item.entries[0])).toEqual({ width: 2, height: 3 });
    item = setTile(item, 'W', 1, 2, null);
    expect(entrySize(item.entries[0])).toEqual({ width: 1, height: 1 });
    expect(entrySize(undefined)).toEqual({ width: 1, height: 1 });
  });

  it('runs dropped tiles along the wall the orientation faces', () => {
    const west = dropTiles(chair, 'W', 0, 0, ['a_0', 'a_1']);
    expect(tileAt(west.entries[0], 0, 0)).toBe('a_0');
    expect(tileAt(west.entries[0], 0, 1)).toBe('a_1');
    const north = dropTiles(chair, 'N', 0, 0, ['b_0', 'b_1']);
    expect(north.entries.map(entry => entry.orient)).toEqual(['W', 'N']);
    expect(tileAt(north.entries[1], 1, 0)).toBe('b_1');
  });

  it('ignores drops outside the grid border and returns the same object for no-op edits', () => {
    expect(dropTiles(chair, 'W', 2, 0, ['a_0'])).toBe(chair);
    expect(setTile(chair, 'W', 0, 0, 'chair_0')).toBe(chair);
    expect(setTile(chair, 'W', 50, 0, 'x_0')).toBe(chair);
    expect(setLayer(chair, 'Furniture')).toBe(chair);
    expect(setGrime(chair, 'W', true)).toBe(chair);
    expect(clearEntry(chair, 'N')).toBe(chair);
  });

  it('edits layer, grime, corners and clears an orientation', () => {
    expect(setLayer(chair, 'Walls').layer).toBe('Walls');
    expect(setGrime(chair, 'W', false).entries[0].grime).toBeFalse();
    const corners = toggleCorners(chair);
    expect(orientsOf(corners)).toEqual(['W', 'N', 'E', 'S', 'SW', 'NW', 'NE', 'SE']);
    expect(orientsOf(chair)).toEqual(['W', 'N', 'E', 'S']);
    expect(clearEntry(chair, 'W').entries[0].items).toEqual([]);
  });

  it('fills N, E and S with the tiles following W', () => {
    const wide: BFurniture = { entries: [{ orient: 'W', items: [{ pos: '0,0', tile: 'oven_01_000' }, { pos: '0,1', tile: 'oven_01_008' }] }] };
    const two = fillSequential(wide, SEQUENCES['+2']);
    expect(two.entries.map(entry => entry.orient)).toEqual(['W', 'N']);
    expect(two.entries[1].items).toEqual([{ pos: '0,0', tile: 'oven_01_001' }, { pos: '0,1', tile: 'oven_01_009' }]);
    const four = fillSequential(setTile(wide, 'E', 3, 3, 'old_0'), SEQUENCES['+4']);
    expect(four.entries.map(entry => entry.items[0].tile)).toEqual(['oven_01_000', 'oven_01_001', 'oven_01_002', 'oven_01_003']);
    expect(four.entries[2].items.length).toBe(2);
    expect(fillSequential({ entries: [] }, SEQUENCES['+2']).entries).toEqual([]);
    const full: BFurniture = { entries: [{ orient: 'W', items: [{ pos: '0,0', tile: 'x_9999' }] }] };
    expect(fillSequential(full, SEQUENCES['+2'])).toBe(full);
  });

  it('fills the half-step sequences starting from W on 001', () => {
    const oven: BFurniture = { entries: [{ orient: 'W', items: [{ pos: '0,0', tile: 'oven_01_001' }] }] };
    expect(fillSequential(oven, SEQUENCES['+1.5']).entries.map(entry => entry.items[0].tile)).toEqual(['oven_01_001', 'oven_01_000']);
    expect(fillSequential(oven, SEQUENCES['+3.5']).entries.map(entry => `${entry.orient}=${entry.items[0].tile}`))
      .toEqual(['W=oven_01_001', 'N=oven_01_000', 'E=oven_01_003', 'S=oven_01_002']);
    const first: BFurniture = { entries: [{ orient: 'W', items: [{ pos: '0,0', tile: 'oven_01_000' }] }] };
    expect(fillSequential(first, SEQUENCES['+1.5'])).toBe(first);
  });

  it('only copies the changed path so undo snapshots share untouched data', () => {
    const groups: BFurnitureGroup[] = [{ label: 'A', furniture: [chair] }, { label: 'B', furniture: [] }];
    const next = updateFurniture(groups, 0, 0, item => setLayer(item, 'Walls'));
    expect(next).not.toBe(groups);
    expect(next[1]).toBe(groups[1]);
    expect(updateFurniture(groups, 0, 0, item => item)).toBe(groups);
  });

  it('moves list items within bounds', () => {
    expect(move([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    const items = [1, 2];
    expect(move(items, 0, -1)).toBe(items);
  });

  it('rejects category labels that would break the file format', () => {
    expect(validCategoryLabel(' Kitchen ')).toBeTrue();
    for (const label of ['', '   ', 'a{b', 'a}b', 'a // b', 'a\nb', 'x'.repeat(101)]) expect(validCategoryLabel(label)).withContext(label).toBeFalse();
  });
});
