import { BuildingService } from './building.service';
import { RoomTileLibraryService } from './room-tile-library.service';
import { roomEntryFromTile, roomEntryKey } from '../utils/room-tile-entries';

describe('Persistent room tile defaults', () => {
    beforeEach(() => localStorage.clear());
    it('keeps bundled defaults available if saved preferences are corrupt', async () => {
        const floor = roomEntryFromTile('floors', 'floor_000');
        const library = new RoomTileLibraryService({ getDefaultTileEntries: async () => [floor] } as BuildingService);
        localStorage.setItem('buildinged.roomTileLibrary.v1', JSON.stringify({ entries: [{ category: 'floors', tiles: [null] }, { category: '__proto__', tiles: [] }] }));
        expect(await library.load()).toEqual([floor]);
    });
    it('saves native entries with empty optional variants, and persists removal and ordering across instances', async () => {
        const floor = roomEntryFromTile('floors', 'floor_000'), wall = roomEntryFromTile('interior_walls', 'wall_000');
        wall.tiles[4].tile = ''; wall.tiles[5].tile = '';
        const source = { getDefaultTileEntries: async () => [floor, wall] } as BuildingService;
        const library = new RoomTileLibraryService(source);
        expect(library.valid(wall)).toBeTrue();
        await library.save([wall, floor]);
        expect((await new RoomTileLibraryService(source).load()).map(roomEntryKey)).toEqual([roomEntryKey(wall), roomEntryKey(floor)]);
        await library.save([wall]);
        expect((await library.load()).map(roomEntryKey)).toEqual([roomEntryKey(wall)]);
    });
});
