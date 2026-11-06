import { TilezedTileset } from './tilezed-map';
import { indexTilezedSheets, localTilezedSheet, tilezedSheetLayout } from './tilezed-sheets';

describe('TileZed local tilesheets', () => {
  const tileset: TilezedTileset = {
    name: 'vegetation_groundcover_01', source: '../../Tiles/vegetation_groundcover_01.png',
    firstGid: 1, tileWidth: 64, tileHeight: 128, imageWidth: 512, imageHeight: 1024, columns: 8, rows: 8,
  };
  const file = (path: string) => {
    const entry = new File(['png'], path.split('/').pop()!, { type: 'image/png' });
    Object.defineProperty(entry, 'webkitRelativePath', { value: path });
    return entry;
  };

  it('prefers 2x images and falls back to the original 1x sheet', () => {
    const one = file('Tiles/vegetation_groundcover_01.png');
    const two = file('Tiles/2x/vegetation_groundcover_01.png');
    expect(localTilezedSheet(indexTilezedSheets([one]), tileset)).toBe(one);
    expect(localTilezedSheet(indexTilezedSheets([one, two]), tileset)).toBe(two);
  });

  it('reports ambiguous same-priority sheets', () => {
    const first = file('Other/a/vegetation_groundcover_01.png');
    const second = file('Other/b/vegetation_groundcover_01.png');
    expect(indexTilezedSheets([first, second]).duplicates).toEqual(['vegetation_groundcover_01']);
  });

  it('validates sheet dimensions and the referenced tile index', () => {
    expect(tilezedSheetLayout(tileset, 23, 512, 1024)).toEqual({ tileWidth: 64, tileHeight: 128 });
    expect(tilezedSheetLayout(tileset, 23, 1024, 2048)).toEqual({ tileWidth: 128, tileHeight: 256 });
    expect(tilezedSheetLayout(tileset, 23, 512, 999)).toEqual({ tileWidth: 64, tileHeight: 128 });
    expect(() => tilezedSheetLayout(tileset, 23, 500, 1024)).toThrowError(/does not match/);
    expect(() => tilezedSheetLayout(tileset, 23, 512, 383)).toThrowError(/does not contain/);
    expect(() => tilezedSheetLayout(tileset, 64, 512, 1024)).toThrowError(/does not contain/);
    expect(() => tilezedSheetLayout(tileset, NaN, 512, 1024)).toThrowError(/does not contain/);
    expect(() => tilezedSheetLayout(tileset, 23, 512, 0)).toThrowError(/invalid dimensions/);
  });

  it('accepts a shorter hosted sheet only when every referenced tile exists', () => {
    const natural = { ...tileset, name: 'blends_natural_01', imageHeight: 2560, rows: 20 };
    expect(tilezedSheetLayout(natural, 62, 1024, 4096)).toEqual({ tileWidth: 128, tileHeight: 256 });
    expect(() => tilezedSheetLayout(natural, 129, 1024, 4096)).toThrowError(/does not contain tile 129/);
  });
});
