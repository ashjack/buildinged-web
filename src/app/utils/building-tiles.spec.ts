import {
  BUILDING_TILE_CATEGORIES, buildingTilesEntryKey, buildingTilesLayout, entryFromSingleTile, parseBuildingTilesDocument, serializeBuildingTiles,
  setEntryOffset, setEntryTile, toTileEntries, updateCategoryEntries,
} from './building-tiles';

describe('BuildingTiles.txt', () => {
  let bundled: string;
  beforeAll(async () => bundled = await (await fetch('/assets/BuildingTiles.txt')).text());

  it('round-trips the bundled file exactly as the desktop editor writes it', () => {
    const document = parseBuildingTilesDocument(bundled);
    expect(document.revision).toBe(8);
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
    expect(document.categories.length).toBe(16);
    expect(document.categories[0].entries).toEqual([{ tiles: { West: 'walls_000' }, offsets: { West: [-1, 2] } }]);
    expect(toTileEntries(document)).toEqual([{ category: 'exterior_walls', tiles: [
      { enum: 'West', tile: 'walls_000', offset: '-1 2' }, ...['North', 'NorthWest', 'SouthEast', 'WestWindow', 'NorthWindow', 'WestDoor', 'NorthDoor']
        .map(key => ({ enum: key, tile: '' }))] }]);
  });

  it('rejects files the desktop editor would reject', () => {
    expect(() => parseBuildingTilesDocument('version = 1\n')).toThrowError(/version 2/);
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
      expect([image.naturalWidth, image.naturalHeight]).withContext(definition.name).toEqual([layout.columns * 64, layout.rows * 128]);
    }
    const tops = buildingTilesLayout(BUILDING_TILE_CATEGORIES.find(c => c.name === 'roof_tops')!);
    expect(tops.cells.filter(cell => cell.template).map(cell => cell.key)).toEqual(['West3', 'West1', 'West2']);
  });
});