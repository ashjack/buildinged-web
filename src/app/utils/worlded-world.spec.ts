import { readWorldedWorld, worldedCellKey } from './worlded-world';

describe('WorldEd world reader', () => {
  const xml = `<world version="1.0" width="2" height="2">
    <bmp path="terrain.png" x="0" y="0" width="2" height="2"/>
    <cell x="1" y="0" map="maps/one.tmx">
      <lot x="-2" y="7" width="4" height="6" level="0" map="buildings/house.tbx"/>
      <object x="0" y="0" width="1" height="1"/>
    </cell>
  </world>`;

  it('reads legacy cells, terrain references, and building footprints', () => {
    const world = readWorldedWorld(xml);
    expect(world.cellSize).toBe(300);
    expect(world.width).toBe(2);
    expect(world.bitmaps[0]).toEqual({ path: 'terrain.png', x: 0, y: 0, width: 2, height: 2 });
    expect(world.cells.get(worldedCellKey(1, 0))).toEqual({
      x: 1, y: 0, map: 'maps/one.tmx',
      lots: [{ x: -2, y: 7, width: 4, height: 6, level: 0, map: 'buildings/house.tbx' }],
      objectCount: 1, featureCount: 0,
    });
    expect(world.lotCount).toBe(1);
    expect(world.warnings.join(' ')).toContain('objects and zones');
  });

  it('supports native 256-tile cells', () => {
    const world = readWorldedWorld('<world width="1" height="1" cellFormat="native-256"/>');
    expect(world.cellSize).toBe(256);
  });

  it('preserves whitespace in terrain image filenames', () => {
    const world = readWorldedWorld(
      '<world width="1" height="1"><bmp path=" terrain .png" x="0" y="0" width="1" height="1"/></world>',
    );
    expect(world.bitmaps[0].path).toBe(' terrain .png');
  });

  it('rejects invalid XML, unsupported formats, and out-of-bounds or duplicate cells', () => {
    expect(() => readWorldedWorld('<world>')).toThrowError(/valid XML/);
    expect(() => readWorldedWorld('<map/>')).toThrowError(/not a WorldEd world/);
    expect(() => readWorldedWorld('<!DOCTYPE world><world width="1" height="1"/>')).toThrowError(/document type/);
    expect(() => readWorldedWorld('<world width="1" height="1" cellFormat="future"/>')).toThrowError(/cell format/);
    expect(() => readWorldedWorld('<world width="1" height="1"><cell x="1" y="0"/></world>')).toThrowError(/Invalid x/);
    expect(() => readWorldedWorld('<world width="1" height="1"><cell x="0" y="0"/><cell x="0" y="0"/></world>'))
      .toThrowError(/duplicate cell/);
  });

  it('reports content omitted from the overview', () => {
    const world = readWorldedWorld(`<world width="1" height="1">
      <road/><otherworld path="other.pzw"/>
      <cell x="0" y="0"><lot x="0" y="0" width="0" height="0"/><feature/><unknown/></cell>
    </world>`);
    expect(world.warnings.join(' ')).toContain('no dimensions');
    expect(world.warnings.join(' ')).toContain('road objects');
    expect(world.warnings.join(' ')).toContain('other worlds');
    expect(world.warnings.join(' ')).toContain('map features');
    expect(world.warnings.join(' ')).toContain('<unknown>');
  });
});
