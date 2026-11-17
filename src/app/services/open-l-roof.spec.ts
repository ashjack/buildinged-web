import { compoundRoofCaps, compoundRoofCells, compoundRoofContains, compoundRoofEnds, isCompoundRoof } from './compound-roof';
import { buildRoofPlacements, defaultRoofCaps, ROOF_OPTIONS } from './roof-patterns';
import { buildingTilesCategory } from '../utils/building-tiles';
import { ROOF_TOOL_GROUPS, roofToolGroup } from '../utils/roof-toolbar';
import { nativeRoofHandles } from '../utils/native-roof';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { generateBuildingSquares } from './native-squares';
import { buildingPreviewTiles } from '../utils/building-preview';
import { transformBuilding, BuildingTransform } from '../utils/building-transform';

const source = (category: string) => buildingTilesCategory(category)!.enums.map(name => ({ enum: name, tile: name }));
const tileset = { capTiles: source('roof_caps'), slopeTiles: source('roof_slopes'), topTiles: source('roof_tops') };
const roof = (type = 'LRoofOpen') => ({ x: 4, y: 5, width: 18, height: 20, roofType: type,
  RoofRotation: 0, RoofMirror: false, RoofMainWidth: 5, RoofReturnWidth: 3 });

describe('Open L-roof gables', () => {
  it('adds both pitches to the existing main dropdown with caps enabled', () => {
    for (const id of ['l-roof-open', 'l-roof-open30']) {
      const option = ROOF_OPTIONS.find(item => item.id === id)!;
      expect(isCompoundRoof(option.roofType)).toBeTrue(); expect(roofToolGroup(option)).toBe('standard');
      expect(ROOF_TOOL_GROUPS[0].options).toContain(option);
      expect(defaultRoofCaps(option.roofType)).toEqual({ cappedW: true, cappedN: true, cappedE: true, cappedS: true });
    }
    expect(ROOF_TOOL_GROUPS.length).toBe(5);
  });
  for (const type of ['LRoofOpen', 'LRoofOpen30']) {
    it(`extends both ${type} ridges to the two gable ends, retaining the L cutout and joined valley`, () => {
      const o = roof(type), cells = compoundRoofCells(o), old = compoundRoofCells({ ...o, roofType: type.replace('Open', '') });
      expect(cells.length).toBe(old.length);
      expect(cells.find(cell => cell.x === o.x && cell.y === o.y + 2)!.face).toBe('NS');
      expect(cells.find(cell => cell.x === o.x + o.width - 2 && cell.y === o.y + o.height - 1)!.face).toBe('WE');
      expect(old.find(cell => cell.x === o.x && cell.y === o.y + 2)!.face).not.toBe('NS');
      expect(cells.every(cell => compoundRoofContains(o, { x: cell.x + .5, y: cell.y + .5 }))).toBeTrue();
      expect(compoundRoofContains(o, { x: o.x + 1, y: o.y + 8 })).toBeFalse();
      expect(cells.find(cell => cell.x === o.x + o.width - o.RoofReturnWidth && cell.y === o.y + o.RoofMainWidth - 1)!.face).toBe('SW');
      expect(new Set(compoundRoofCaps(o).map(cap => cap.side))).toEqual(new Set(['W', 'S']));
    });
    it(`matches native ${type} peak-cap profiles for every supported odd/even slope width and wide centres`, () => {
      for (let width = 1; width <= 18; width++) {
        const o = { ...roof(type), width: 24, height: 26, RoofMainWidth: width, RoofReturnWidth: width };
        const caps = compoundRoofCaps(o), shallow = type.endsWith('30');
        const nativeMain = buildRoofPlacements({ x: o.x, y: o.y, width: o.width, height: width, level: 0,
          roofType: shallow ? 'Peak30WE' : 'PeakWE', tileset, cappedW: true, cappedE: false, cappedN: false, cappedS: false });
        const nativeReturn = buildRoofPlacements({ x: o.x + o.width - width, y: o.y, width, height: o.height, level: 0,
          roofType: shallow ? 'Peak30NS' : 'PeakNS', tileset, cappedW: false, cappedE: false, cappedN: false, cappedS: true });
        // Native 30-degree peaks clamp to 12 tiles; wide compound gables continue with CapGap tiles.
        if (!shallow || width <= 12) {
          expect(caps.filter(cap => cap.side === 'W').map(cap => cap.tile + '.png')).withContext(`width ${width}`).toEqual(nativeMain.filter(tile => tile.layer === 'RoofCap').map(tile => tile.name!));
          expect(caps.filter(cap => cap.side === 'S').map(cap => cap.tile + '.png')).withContext(`width ${width}`).toEqual(nativeReturn.filter(tile => tile.layer === 'RoofCap').map(tile => tile.name!));
        }
        expect(caps.length).toBe(width * 2); expect(caps.every(cap => buildingTilesCategory('roof_caps')!.enums.includes(cap.tile))).toBeTrue();
        if (width > (shallow ? 12 : 6)) expect(caps.some(cap => cap.tile.startsWith('CapGap'))).toBeTrue();
      }
    });
    for (const rotation of [0, 1, 2, 3]) for (const mirror of [false, true]) {
      it(`keeps ${type} caps on only the free ends at rotation ${rotation}, mirror ${mirror}`, () => {
        const o = { ...roof(type), RoofRotation: rotation, RoofMirror: mirror };
        const ends = compoundRoofEnds(o), caps = compoundRoofCaps(o), allowed = new Set(ends.map(end => end.side));
        expect(ends.length).toBe(2); expect(caps.every(cap => allowed.has(cap.side))).toBeTrue();
        for (const end of ends) {
          const vertical = end.side === 'W' || end.side === 'E';
          const line = end.side === 'W' ? end.rect.x : end.side === 'E' ? end.rect.x + end.rect.width : end.side === 'N' ? end.rect.y : end.rect.y + end.rect.height;
          expect(caps.filter(cap => cap.side === end.side).every(cap => (vertical ? cap.x : cap.y) === line)).toBeTrue();
        }
        const placements = buildRoofPlacements({ ...o, level: 0, tileset });
        expect(placements.filter(tile => tile.layer === 'RoofCap').length).toBe(caps.length);
        expect(new Set(placements.filter(tile => tile.layer === 'RoofCap').map(tile => `${tile.x},${tile.y}`)).size).toBe(caps.length);
        expect(nativeRoofHandles({ ...o, RoofType: type }).filter(handle => handle.kind.startsWith('capped')).map(handle => String(handle.kind)).sort()).toEqual([...allowed].map(side => 'capped' + side).sort());
        const suppressed = buildRoofPlacements({ ...o, level: 0, tileset, [`capped${ends[0].side}`]: false });
        expect(suppressed.filter(tile => tile.layer === 'RoofCap').every(tile => tile.tag === 'capped' + ends[1].side)).toBeTrue();
      });
    }
    it(`preserves ${type} materials, cap flags and geometry through save/reopen, transforms and TileZed preview`, () => {
      const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')); b.width = b.height = 48;
      b.entries = [{ category: 'roof_caps', tiles: tileset.capTiles }, { category: 'roof_slopes', tiles: tileset.slopeTiles }, { category: 'roof_tops', tiles: tileset.topTiles }];
      b.floors = [{ rooms: '', objects: [{ ...roof(type), type: 'roof', RoofType: type, uid: 'open-l-roof', CapTiles: 1, SlopeTiles: 2, TopTiles: 3, ...defaultRoofCaps(type) }] }];
      const tiles = generateBuildingSquares(b).tiles;
      expect(tiles.some(tile => tile.layer === 'RoofCap')).toBeTrue(); expect(buildingPreviewTiles(b)).toEqual(tiles);
      const saved = readBuildingFile(writeBuildingFile(b));
      const withoutUid = (items: typeof tiles) => items.map(({ object, ...tile }) => tile);
      expect(saved.floors[0].objects[0].RoofType).toBe(type);
      expect(withoutUid(generateBuildingSquares(saved).tiles)).toEqual(withoutUid(tiles));
      for (const operation of ['rotate-left', 'rotate-right', 'flip-horizontal', 'flip-vertical'] as BuildingTransform[]) {
        const transformed = transformBuilding(saved, operation);
        expect(buildingPreviewTiles(transformed)).toEqual(generateBuildingSquares(transformed).tiles);
        expect(generateBuildingSquares(transformed).tiles.filter(tile => tile.layer === 'RoofCap').length).toBe(8);
      }
    });
  }
  it('clips a short 30-degree wing cap to the actual half-height plateau', () => {
    const o = { ...roof('LRoofOpen30'), width: 3, height: 18, RoofMainWidth: 15, RoofReturnWidth: 1 };
    const caps = compoundRoofCaps(o);
    expect(caps.some(cap => cap.tile === 'CapGapE2' && cap.clip?.length)).toBeTrue();
    expect(caps.every(cap => buildingTilesCategory('roof_caps')!.enums.includes(cap.tile))).toBeTrue();
    expect(buildRoofPlacements({ ...o, level: 0, tileset }).some(tile => tile.layer === 'RoofCap' && tile.clip?.length)).toBeTrue();
  });
});
