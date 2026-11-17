import { compoundRoofCaps, compoundRoofCells } from './compound-roof';
import { buildRoofPlacements } from './roof-patterns';
import { buildingTilesCategory } from '../utils/building-tiles';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { generateBuildingSquares } from './native-squares';
import { buildingPreviewTiles } from '../utils/building-preview';

const source = (category: string) => buildingTilesCategory(category)!.enums.map(name => ({ enum: name, tile: name }));
const tileset = { slopeTiles: source('roof_slopes'), capTiles: source('roof_caps'), topTiles: source('roof_tops') };
const reported = { x: 5, y: 5, width: 11, height: 13, roofType: 'LRoofOpen', RoofRotation: 1,
  RoofMirror: false, RoofMainWidth: 6, RoofReturnWidth: 8, RoofWingWidth: 0 };

describe('Continuous compound-roof joins', () => {
  it('retains all four real facets at a small hipped peak', () => {
    for (const [type, tile] of [['LRoof', 'OuterPt5'], ['LRoof30', 'Peak30Quad1']]) {
      for (const origin of [0, 5, 17]) {
        const cells = compoundRoofCells({ x: origin, y: origin, width: 3, height: 3, roofType: type, RoofMainWidth: 1, RoofReturnWidth: 1 });
        expect(cells.find(cell => cell.x === origin + 2 && cell.y === origin)).toEqual({ x: origin + 2, y: origin, tile, face: 'Quad' });
      }
    }
  });
  for (const type of ['LRoofOpen', 'LRoofOpen30']) it(`keeps full slope tiles beside the 13×6 / 11×8, 90-degree ${type} join`, () => {
    const o = { ...reported, roofType: type }, cells = compoundRoofCells(o);
    const placed = buildRoofPlacements({ ...o, level: 0, tileset });
    for (let step = 0; step < 3; step++) {
      const x = o.x + 7 - step, y = o.y + 10 + step, name = `${type.endsWith('30') ? 'Slope30S' : 'SlopeS'}${3 - step}`;
      expect(cells.find(cell => cell.x === x && cell.y === y)).toEqual({ x, y, tile: name, face: 'S' });
      expect(placed.filter(tile => tile.x === x && tile.y === y && tile.layer === 'Roof').map(tile => tile.name!)).toEqual([name + '.png']);
    }
  });
  for (const type of ['LRoofOpen', 'LRoofOpen30', 'LRoof', 'LRoof30', 'TRoof', 'TRoof30']) {
    for (const rotation of [0, 1, 2, 3]) for (const mirror of [false, true]) {
      it(`preserves ${type} facets when moved (rotation ${rotation}, mirror ${mirror})`, () => {
        for (const [main, ret] of [[6, 8], [5, 3], [8, 6]]) {
          const o = { ...reported, x: 0, y: 0, width: rotation % 2 ? 11 : 13, height: rotation % 2 ? 13 : 11,
            roofType: type, RoofRotation: rotation, RoofMirror: mirror, RoofMainWidth: main, RoofReturnWidth: ret };
          const cells = compoundRoofCells(o), caps = compoundRoofCaps(o);
          for (const [x, y] of [[1, 1], [5, 5], [4, 17], [31, 37]]) {
            expect(compoundRoofCells({ ...o, x, y }).map(cell => ({ ...cell, x: cell.x - x, y: cell.y - y })))
              .withContext(`wings ${main}/${ret}, position ${x},${y}`).toEqual(cells);
            expect(compoundRoofCaps({ ...o, x, y }).map(cap => ({ ...cap, x: cap.x - x, y: cap.y - y }))).toEqual(caps);
          }
        }
      });
    }
  }
  it('keeps the repaired join in the editor, TileZed preview, and saved building', () => {
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')); b.width = b.height = 48;
    b.entries = [{ category: 'roof_slopes', tiles: tileset.slopeTiles }, { category: 'roof_caps', tiles: tileset.capTiles }, { category: 'roof_tops', tiles: tileset.topTiles }];
    b.floors = [{ rooms: '', objects: [{ ...reported, type: 'roof', RoofType: reported.roofType, uid: 'reported-roof', SlopeTiles: 1, CapTiles: 2, TopTiles: 3 }] }];
    const tiles = generateBuildingSquares(b).tiles;
    expect(tiles.find(tile => tile.x === 12 && tile.y === 15 && tile.layer === 'Roof')!.name).toBe('SlopeS3.png');
    expect(buildingPreviewTiles(b)).toEqual(tiles);
    const saved = readBuildingFile(writeBuildingFile(b)), reopened = generateBuildingSquares(saved).tiles;
    const withoutUid = (items: typeof tiles) => items.map(({ object, ...tile }) => tile);
    expect(withoutUid(reopened)).toEqual(withoutUid(tiles));
  });
});
