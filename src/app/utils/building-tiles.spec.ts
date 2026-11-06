import {
  BUILDING_TILE_CATEGORIES, buildingTilesEntryKey, buildingTilesLayout, entryFromSingleTile, parseBuildingTilesDocument, serializeBuildingTiles,
  setEntryOffset, setEntryTile, toTileEntries, updateCategoryEntries, windowShape, windowTemplateOffset, windowWallEnum,
} from './building-tiles';

describe('BuildingTiles.txt', () => {
  let bundled: string;
  beforeAll(async () => bundled = await (await fetch('/assets/BuildingTiles.txt')).text());

  it('round-trips the bundled file exactly as the desktop editor writes it', () => {
    const document = parseBuildingTilesDocument(bundled);
    expect(document.revision).toBe(43);
    expect(document.categories.find(category => category.name === 'exterior_walls')!.entries.some(entry => entry.tiles['NorthWindow19'])).toBeTrue();
    expect(document.categories.map(category => category.name)).toEqual(BUILDING_TILE_CATEGORIES.map(category => category.name));
    expect(document.categories.every(category => category.entries.length > 0)).toBeTrue();
    expect(serializeBuildingTiles(document)).toBe(bundled.replace(/\r\n/g, '\n').replace(/\n*$/, '\n'));
  });

  it('reads blocks with braces on the same line, blank slots and offsets, and gives every category back', () => {
    const document = parseBuildingTilesDocument(`version = 2
      revision = 3
      source_revision = 1
      category {
        name = exterior_walls
        entry {
          West = walls_000
          North =
          offset = West -1 2
          offset = North 0 0
        }
      }`);
    expect(document.sourceRevision).toBe(1);
    expect(document.categories.length).toBe(17);
    expect(document.categories[0].entries).toEqual([{ tiles: { West: 'walls_000' }, offsets: { West: [-1, 2] } }]);
    expect(toTileEntries(document)).toEqual([{ category: 'exterior_walls', tiles: [
      { enum: 'West', tile: 'walls_000', offset: '-1 2' }, ...['North', 'NorthWest', 'SouthEast', 'WestWindow', 'NorthWindow',       'WestDoor', 'NorthDoor',
              ...Array.from({ length: 19 }, (_, i) => [`WestWindow${i + 1}`, `NorthWindow${i + 1}`]).flat()].map(key => ({ enum: key, tile: '' }))] }]);
  });

  it('rejects files the desktop editor would reject', () => {
    expect(() => parseBuildingTilesDocument('version = 1\n')).toThrowError(/version 2 to 4/);
    expect(() => parseBuildingTilesDocument('version = 5\n')).toThrowError(/version 2 to 4/);
    expect(() => parseBuildingTilesDocument('version = 2\ncategory\n{\nname = sofas\n}\n')).toThrowError(/Unknown category/);
    expect(() => parseBuildingTilesDocument('version = 2\ncategory\n{\nname = doors\nentry\n{\nFloor = a_000\n}\n}\n')).toThrowError(/slot/);
    expect(() => parseBuildingTilesDocument('version = 2\ncategory\n{\n')).toThrowError(/unclosed/);
  });

  it('builds entries from one tile like createEntryFromSingleTile, remapping rows onto wider sheets', () => {
    expect(entryFromSingleTile('exterior_walls', 'walls_01_016.png').tiles).toEqual({
      West: 'walls_01_016', North: 'walls_01_017', NorthWest: 'walls_01_018', SouthEast: 'walls_01_019',
      WestWindow: 'walls_01_024', NorthWindow: 'walls_01_025', WestDoor: 'walls_01_026', NorthDoor: 'walls_01_027',
    });
    expect(entryFromSingleTile('stairs', 'stairs_000', 16).tiles).toEqual({
      West1: 'stairs_000', West2: 'stairs_001', West3: 'stairs_002', North1: 'stairs_016', North2: 'stairs_017', North3: 'stairs_018',
    });
    const top = entryFromSingleTile('roof_tops', 'roofs_005');
    expect(Object.values(top.tiles)).toEqual(Array(6).fill('roofs_005'));
    expect(top.offsets).toEqual({ West1: [-1, -1], West2: [-2, -2], North1: [-1, -1], North2: [-2, -2] });
    expect(Object.keys(entryFromSingleTile('roof_caps', 'roofs_000').tiles)).not.toContain('CapGapS1');
  });

  it('edits immutably and treats entries with the same tiles as duplicates', () => {
    const entry = { tiles: { West: 'a_000' } };
    expect(setEntryTile(entry, 'West', 'a_000.png')).toBe(entry);
    const both = setEntryTile(entry, 'North', 'a_001.png');
    expect(both).toEqual({ tiles: { West: 'a_000', North: 'a_001' } });
    expect(setEntryTile(both, 'North', null)).toEqual(entry);
    const offset = setEntryOffset(entry, 'West', 1, 0);
    expect(offset).toEqual({ tiles: { West: 'a_000' }, offsets: { West: [1, 0] } });
    expect(setEntryOffset(offset, 'West', 0, 0)).toEqual(entry);
    expect(buildingTilesEntryKey({ tiles: { North: 'a_001', West: 'a_000' } })).toBe(buildingTilesEntryKey(both));
    expect(buildingTilesEntryKey(offset)).not.toBe(buildingTilesEntryKey(entry));
    const document = parseBuildingTilesDocument('version = 2\n');
    expect(updateCategoryEntries(document, 'doors', entries => entries)).toBe(document);
    expect(updateCategoryEntries(document, 'doors', entries => [...entries, entry]).categories[5].entries).toEqual([entry]);
  });

  it('lays every slot out once over the desktop expert-mode templates', async () => {
    for (const definition of BUILDING_TILE_CATEGORIES) {
      const layout = buildingTilesLayout(definition);
      const keys = layout.cells.map(cell => cell.key).filter(Boolean);
      expect([...keys].sort()).withContext(definition.name).toEqual([...definition.enums].sort());
      const image = new Image();
      image.src = '/' + layout.image;
      await image.decode();
      expect([image.naturalWidth, image.naturalHeight]).withContext(definition.name).toEqual([layout.imageColumns * 64, layout.imageRows * 128]);
    }
    const tops = buildingTilesLayout(BUILDING_TILE_CATEGORIES.find(c => c.name === 'roof_tops')!);
    expect(tops.cells.filter(cell => cell.template).map(cell => cell.key)).toEqual(['West3', 'West1', 'West2']);
    const walls = buildingTilesLayout(BUILDING_TILE_CATEGORIES[0]);
    expect(walls.cells[8].key).toBe('WestWindow1');
    expect(walls.cells.slice(40).map(cell => cell.key)).toEqual(['WestWindow17', 'WestWindow18', 'NorthWindow17', 'NorthWindow18', 'WestWindow19', 'NorthWindow19', null, null]);
  });

  it('picks window frames from the WindowShape tile property like the window-frame fork', () => {
    expect(windowShape('fixtures_windows_church_004')).toBe(3);
    expect(windowShape('fixtures_windows_01_41.png')).toBe(18);
    expect(windowShape('fixtures_windows_01_000')).toBe(0);
    expect(windowWallEnum('North', 'fixtures_windows_01_072')).toBe('NorthWindow19');
    expect(windowWallEnum('West', 'fixtures_windows_01_000')).toBe('WestWindow');
    expect(windowWallEnum('West', undefined)).toBe('WestWindow');
    expect(windowTemplateOffset('West', 'fixtures_windows_church_004')).toEqual([4, 1]);
    expect(windowTemplateOffset('North', 'fixtures_windows_01_040')).toEqual([3, 0]);
    expect(windowTemplateOffset('West', 'fixtures_windows_01_000')).toEqual([0, 0]);
  });
});