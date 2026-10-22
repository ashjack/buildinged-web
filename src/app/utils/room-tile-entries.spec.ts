import { roomEntryFromTile, roomEntryKey } from './room-tile-entries';

describe('Native room tile entries', () => {
    it('creates the native eight wall/trim variants with padded sprite indices', () => {
        for (const category of ['interior_walls', 'interior_wall_trim']) {
            const entry = roomEntryFromTile(category, 'walls_01_4.png');
            expect(entry.tiles.map(t => [t.enum, t.tile])).toEqual([
                ['West', 'walls_01_004'], ['North', 'walls_01_005'], ['NorthWest', 'walls_01_006'], ['SouthEast', 'walls_01_007'],
                ['WestWindow', 'walls_01_012'], ['NorthWindow', 'walls_01_013'], ['WestDoor', 'walls_01_014'], ['NorthDoor', 'walls_01_015']]);
        }
    });
    it('uses the native floor-grime ordering and leaves optional wall-grime variants empty', () => {
        const floor = roomEntryFromTile('grime_floor', 'grime_000');
        expect(floor.tiles.map(t => t.tile)).toEqual(['grime_000', 'grime_001', 'grime_009', 'grime_008', 'grime_011', 'grime_002', 'grime_003', 'grime_010']);
        const wall = roomEntryFromTile('grime_wall', 'wall_016');
        expect(wall.tiles.length).toBe(16); expect(wall.tiles.slice(8).every(t => t.tile === 'None')).toBeTrue();
        expect(roomEntryFromTile('floors', 'floor_013.png').tiles).toEqual([{ enum: 'Floor', tile: 'floor_013' }]);
    });
    it('interns equivalent entries regardless of enum order, zero offsets, or explicit empty variants', () => {
        const entry = roomEntryFromTile('interior_walls', 'walls_000');
        expect(roomEntryKey(entry)).toBe(roomEntryKey({ ...entry, tiles: [...entry.tiles].reverse().map(t => ({ ...t, offset: '0 0' })).concat({ enum: 'unused', tile: 'None', offset: '0 0' }) }));
    });
});
