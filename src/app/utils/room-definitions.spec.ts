import { EditRoomDefinitions, Redo, Undo } from '../app.actions';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from './tbx-format';
import { readIndexGrid, writeIndexGrid } from './tbx-grid';
import { newRoomDefinition, RoomDefinitionDraft } from './room-definitions';
import ToolDrawRoom from '../tools/tool-draw-room';
import { roomEntryFromTile } from './room-tile-entries';

function setup() {
    localStorage.clear();
    const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    building.entries.push({ category: 'floors', tiles: [{ enum: 'Floor', tile: 'new_room_floor' }] });
    building.rooms.push({ ...building.rooms[0], Name: 'Kitchen', InternalName: 'kitchen', Color: '200 200 200' });
    building.floors[0].rooms = writeIndexGrid([[1, 2], [0, 1]]);
    building.floors.push({ rooms: writeIndexGrid([[2, 0], [1, 2]]), objects: [], tileLayers: [] });
    const h = documentHarness(building);
    const drafts = (): RoomDefinitionDraft[] => h.buildings.building.rooms.map((room, originalIndex) => ({ originalIndex, room: { ...room } }));
    const apply = (values: RoomDefinitionDraft[]) => h.store.dispatch(new EditRoomDefinitions(h.buildings.building.rooms, values, 0));
    return { ...h, drafts, apply };
}

describe('Room definition editing', () => {
    it('registers selected library definitions atomically and preserves variants and offsets through undo and TBX', () => {
        const h = setup(), before = h.buildings.building, drafts = h.drafts();
        const wall = roomEntryFromTile('interior_walls', 'walls_024'); wall.tiles[0].offset = '-1 2';
        drafts[0].materials = { InteriorWall: wall, Floor: roomEntryFromTile('floors', 'custom_floor_005') };
        drafts[1].materials = { InteriorWall: { ...wall, tiles: [...wall.tiles].reverse() } };
        h.apply(drafts);
        const building = h.buildings.building;
        expect(building.entries.length).toBe(before.entries.length + 2);
        expect(building.rooms[0].InteriorWall).toBe(building.rooms[1].InteriorWall);
        const reopened = readBuildingFile(writeBuildingFile(building));
        expect(reopened.entries[building.rooms[0].InteriorWall - 1]).toEqual(wall);
        expect(reopened.entries[building.rooms[0].Floor - 1].tiles[0].tile).toBe('custom_floor_005');
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); expect(h.buildings.building).toBe(building);
        h.destroy();
    });

    it('reuses document definitions, supports None and rejects a definition from the wrong category', () => {
        const h = setup(), before = h.buildings.building, drafts = h.drafts();
        drafts[0].materials = { Floor: before.entries[1] }; h.apply(drafts);
        expect(h.buildings.building.entries).toBe(before.entries);
        const none = h.drafts(); none[0].materials = { Floor: null }; h.apply(none);
        expect(h.buildings.building.rooms[0].Floor).toBe(0);
        const after = h.buildings.building, wrong = h.drafts(); wrong[0].materials = { Floor: roomEntryFromTile('interior_walls', 'wall_000') };
        h.apply(wrong); expect(h.buildings.building).toBe(after);
        h.destroy();
    });
    it('creates rooms with native unused names/colors and generates floors when the new room is painted', () => {
        const h = setup(), before = h.buildings.building, drafts = h.drafts();
        const room = newRoomDefinition(before, before.rooms);
        expect(room).toEqual(jasmine.objectContaining({ Name: 'Room 1', InternalName: 'room1', Color: '128 128 128', Floor: 2 }));
        h.apply([...drafts, { originalIndex: null, room }]);
        h.rooms.selectedRoomIndex = 2;
        const tool = new ToolDrawRoom(h.rooms, h.grid, h.buildings, h.store as any);
        tool.clickTile(0, 1);
        expect(readIndexGrid(h.buildings.building.floors[0].rooms, 2, 2)[1][0]).toBe(3);
        expect(h.grid.roomTiles.some(tile => tile.x === 0 && tile.y === 1 && tile.layer === 'Floor' && tile.name === 'new_room_floor.png')).toBeTrue();
        h.destroy();
    });

    it('reorders and renames rooms without changing which room occupies any floor cell', () => {
        const h = setup(), before = h.buildings.building, drafts = h.drafts();
        drafts[0].room.Name = 'Renamed office'; drafts[0].room.InternalName = 'renamed';
        h.apply([drafts[1], drafts[0]]);
        expect(h.buildings.building.rooms.map(r => r.Name)).toEqual(['Kitchen', 'Renamed office']);
        expect(readIndexGrid(h.buildings.building.floors[0].rooms, 2, 2)).toEqual([[2, 1], [0, 2]]);
        expect(readIndexGrid(h.buildings.building.floors[1].rooms, 2, 2)).toEqual([[1, 0], [2, 1]]);
        expect(h.state.value.past.length).toBe(1);
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); expect(h.buildings.building.rooms[1].InternalName).toBe('renamed');
        const reopened = readBuildingFile(writeBuildingFile(h.buildings.building));
        expect(reopened.rooms).toEqual(h.buildings.building.rooms);
        expect(reopened.floors.map(f => f.rooms)).toEqual(h.buildings.building.floors.map(f => f.rooms));
        h.destroy();
    });

    it('clears deleted room membership on every floor and preserves objects and manual tiles', () => {
        const h = setup(), before = h.buildings.building;
        h.apply([h.drafts()[1]]);
        expect(readIndexGrid(h.buildings.building.floors[0].rooms, 2, 2)).toEqual([[0, 1], [0, 0]]);
        expect(readIndexGrid(h.buildings.building.floors[1].rooms, 2, 2)).toEqual([[1, 0], [0, 1]]);
        expect(h.buildings.building.floors[0].objects).toBe(before.floors[0].objects);
        expect(h.buildings.building.floors[0].tileLayers).toBe(before.floors[0].tileLayers);
        h.apply([]);
        expect(h.buildings.building.rooms).toEqual([]);
        expect(h.buildings.building.floors.every(f => readIndexGrid(f.rooms, 2, 2).every(row => row.every(i => i === 0)))).toBeTrue();
        h.destroy();
    });

    it('gives a duplicate an independent identity even when its names match the original', () => {
        const h = setup(), drafts = h.drafts();
        h.apply([{ originalIndex: null, room: { ...drafts[0].room } }, ...drafts]);
        expect(readIndexGrid(h.buildings.building.floors[0].rooms, 2, 2)).toEqual([[2, 3], [0, 2]]);
        h.destroy();
    });

    it('does not record no-op, invalid or stale room edits', () => {
        const h = setup(), before = h.state.value;
        h.apply(h.drafts()); expect(h.state.value).toBe(before);
        const invalid = h.drafts(); invalid[0].room.Name = ''; h.apply(invalid); expect(h.state.value).toBe(before);
        const stale = new EditRoomDefinitions(h.buildings.building.rooms, h.drafts(), 0);
        const edited = h.drafts(); edited[0].room.Color = '0 255 0'; h.apply(edited);
        const after = h.state.value; h.store.dispatch(stale); expect(h.state.value).toBe(after);
        h.destroy();
    });
});
