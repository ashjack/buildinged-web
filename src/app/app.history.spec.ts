import { AddObject, AddTile, EditRooms, EditTiles, Redo, RemoveObject, RemoveObjects, SetBuilding, SetCurrentTool, Undo, UpdateObject } from './app.actions';
import { HISTORY_LIMIT, initialState, reducer } from './app.reducers';
import { nativeBuildingXml } from './testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from './utils/tbx-format';
import { readIndexGrid } from './utils/tbx-grid';

const opened = () => reducer(initialState, new SetBuilding(readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'))));

describe('Undoable document commands', () => {
    it('undoes and redoes a whole room or tile drag as one command', () => {
        const before = opened();
        const rooms = reducer(before, new EditRooms({ x: 0, y: 0, width: 2, height: 2 }, 0, 0));
        expect(rooms.past.length).toBe(1);
        expect(rooms.past[0].label).toBe('Erase rooms');
        expect(reducer(rooms, new Undo()).building).toBe(before.building);
        expect(reducer(reducer(rooms, new Undo()), new Redo()).building).toBe(rooms.building);
        const tiles = reducer(rooms, new EditTiles({ x: 0, y: 0, width: 3, height: 3 }, 0, 'Walls', 'walls_exterior_house_01_000.png'));
        const erased = reducer(tiles, new EditTiles({ x: 0, y: 0, width: 3, height: 3 }, 0, 'Walls', null));
        expect(erased.past.length).toBe(3);
        expect(reducer(erased, new Undo()).building).toBe(tiles.building);
        expect(reducer(reducer(erased, new Undo()), new Undo()).building).toBe(rooms.building);
    });

    it('restores object UIDs, ordering, furniture definitions and references exactly', () => {
        const before = opened();
        const add = new AddObject({ type: 'furniture', x: 1, y: 0, orient: 'W' }, 0,
            { entries: [{ orient: 'W', tiles: [{ x: 0, y: 0, name: 'furniture_seating_indoor_01_005' }] }] });
        const placed = reducer(before, add);
        const undo = reducer(placed, new Undo());
        expect(undo.building!.furniture).toBe(before.building!.furniture);
        const redo = reducer(undo, new Redo());
        expect(redo.building).toBe(placed.building);
        expect(redo.building!.floors[0].objects[2].uid).toBe(add.obj.uid);
        expect(redo.building!.floors[0].objects[2].FurnitureTiles).toBe(2);
        const deleted = reducer(redo, new RemoveObject(add.obj.uid));
        expect(reducer(deleted, new Undo()).building).toBe(redo.building);
        expect(() => writeBuildingFile(redo.building!)).not.toThrow();
    });

    it('groups bulk deletion and preserves overlapping objects not included by UID', () => {
        const before = opened();
        const ids = before.building!.floors[0].objects.map(object => object.uid);
        const removed = reducer(before, new RemoveObjects([ids[0], ids[0], 'missing']));
        expect(removed.building!.floors[0].objects.map(object => object.uid)).toEqual([ids[1]]);
        expect(removed.past.length).toBe(1);
        expect(reducer(removed, new Undo()).building).toBe(before.building);
    });

    it('keeps redo through UI changes and no-ops and clears it after a new edit', () => {
        const before = opened();
        const edited = reducer(before, new AddTile(0, 0, 0, 'Walls', 'walls_exterior_house_01_000.png'));
        const undone = reducer(edited, new Undo());
        const ui = reducer(undone, new SetCurrentTool('tool-roof'));
        const noOp = reducer(ui, new RemoveObject('missing'));
        expect(noOp.future.length).toBe(1);
        expect(noOp.past.length).toBe(0);
        const branched = reducer(noOp, new EditRooms({ x: 0, y: 0, width: 1, height: 1 }, 0, 0));
        expect(branched.future.length).toBe(0);
        expect(reducer(branched, new Redo())).toBe(branched);
        expect(reducer(before, new Undo())).toBe(before);
    });

    it('clears history when opening a document and does not serialize history or runtime UIDs', () => {
        const before = opened();
        const edited = reducer(before, new UpdateObject(before.building!.floors[0].objects[0].uid, { x: 1 }));
        const openedAgain = reducer(edited, new SetBuilding(before.building!));
        expect(openedAgain.past).toEqual([]);
        expect(openedAgain.future).toEqual([]);
        expect(openedAgain.documentId).toBe(edited.documentId + 1);
        const xml = new XMLSerializer().serializeToString(writeBuildingFile(edited.building!));
        expect(xml).not.toContain('uid=');
        expect(xml).not.toContain('history');
    });

    it('bounds history and ignores empty or invalid erasures', () => {
        let state = opened();
        for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
            state = reducer(state, new EditRooms({ x: 0, y: 0, width: 1, height: 1 }, 0, index % 2));
        }
        expect(state.past.length).toBe(HISTORY_LIMIT);
        const before = state;
        expect(reducer(state, new EditTiles({ x: 0, y: 0, width: 1, height: 1 }, 0, 'missing', null))).toBe(before);
        for (let index = 0; index < HISTORY_LIMIT; index++) state = reducer(state, new Undo());
        expect(state.past.length).toBe(0);
        expect(state.future.length).toBe(HISTORY_LIMIT);
        expect(reducer(state, new Undo())).toBe(state);
        expect(readIndexGrid(state.building!.floors[0].rooms, 2, 2).length).toBe(2);
    });
});
