import { Building, TileEntry } from '../models/app.models';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile } from './tbx-format';
import { materialIdentity, materialMenuEntries, overrideBuildingMaterials } from './material-catalog';

describe('Published material precedence', () => {
    const old: TileEntry = { category: 'exterior_walls', tiles: [
        { enum: 'West', tile: 'walls_exterior_house_01_0.png' }, { enum: 'North', tile: 'walls_exterior_house_01_1' },
        { enum: 'WestWindow', tile: 'walls_exterior_house_01_8' },
    ] };
    const published: TileEntry = { category: 'exterior_walls', tiles: [
        { enum: 'West', tile: 'walls_exterior_house_01_000' }, { enum: 'North', tile: 'walls_exterior_house_01_001' },
        { enum: 'WestWindow13', tile: 'custom_frames_013' }, { enum: 'NorthWindow15', tile: 'custom_frames_015' },
    ] };

    it('matches the displayed material across sprite padding and changed slots without crossing categories', () => {
        expect(materialIdentity(old)).toBe(materialIdentity(published));
        expect(materialIdentity({ ...old, category: 'interior_walls' })).not.toBe(materialIdentity(published));
        expect(materialIdentity({ category: 'windows', tiles: [] })).toBeUndefined();
    });

    it('overrides loaded definitions without renumbering references or mutating the server catalog', () => {
        const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
        b.entries = [old, { ...old, category: 'interior_walls' }, { ...old, tiles: [...old.tiles, { enum: 'NorthWindow', tile: 'stale_009' }] }];
        b.ExteriorWall = 1; b.rooms[0].InteriorWall = 2;
        b.floors[0].objects.push({ uid: 'wall', type: 'wall', Tile: 3 });
        const updated = overrideBuildingMaterials(b, [published]);
        expect(updated.entries[0]).toEqual(published); expect(updated.entries[2]).toEqual(published);
        expect(updated.entries[1]).toBe(b.entries[1]);
        expect(updated.entries[0]).not.toBe(published);
        expect(updated.ExteriorWall).toBe(1); expect(updated.floors).toBe(b.floors);
        expect(b.entries[0]).toBe(old);
        expect(overrideBuildingMaterials(updated, [published])).toBe(updated);
    });

    it('shows one server row for a material while preserving unmatched local materials', () => {
        const custom: TileEntry = { ...old, tiles: [{ enum: 'West', tile: 'unique_local_000' }] };
        expect(materialMenuEntries([published], [old, custom, old])).toEqual([custom, published]);
        const window: TileEntry = { category: 'windows', tiles: [{ enum: 'West', tile: 'custom_window_000', windowShape: 13 }] };
        expect(materialMenuEntries([window], [{ ...window, tiles: window.tiles.map(({ windowShape, ...tile }) => tile) }])).toEqual([window]);
    });
});
