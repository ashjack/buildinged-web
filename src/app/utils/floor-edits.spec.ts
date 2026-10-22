import { AddTile, EditFloor, Redo, Undo, UpdateObject } from '../app.actions';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from './tbx-format';
import { readIndexGrid } from './tbx-grid';

function setup() {
    localStorage.clear();
    return documentHarness(readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')));
}

describe('Undoable native floor operations', () => {
    it('inserts an empty floor above the current one and restores the selected floor on undo/redo', () => {
        const h = setup(), original = h.buildings.building;
        h.store.dispatch(new EditFloor('add', 0));
        expect(h.buildings.building.floors[0]).toBe(original.floors[0]);
        expect(h.buildings.building.floors[1].objects).toEqual([]);
        expect(readIndexGrid(h.buildings.building.floors[1].rooms, 2, 2)).toEqual([[0, 0], [0, 0]]);
        expect(h.grid.getSelectedLevel()).toBe(1);
        h.store.dispatch(new Undo());
        expect(h.buildings.building).toBe(original); expect(h.grid.getSelectedLevel()).toBe(0);
        h.store.dispatch(new Redo());
        expect(h.grid.getSelectedLevel()).toBe(1); expect(h.buildings.building.floors.length).toBe(2);
        h.destroy();
    });

    it('duplicates all floor data with fresh object UIDs, so editing the copy leaves the original intact', () => {
        const h = setup(), original = h.buildings.building.floors[0];
        h.store.dispatch(new EditFloor('duplicate', 0));
        const copy = h.buildings.building.floors[1];
        expect(copy.rooms).toBe(original.rooms); expect(copy.tileLayers).toEqual(original.tileLayers);
        expect(copy.objects.map(o => o.uid)).not.toEqual(original.objects.map(o => o.uid));
        h.store.dispatch(new UpdateObject(copy.objects[0].uid, { x: 1 }));
        expect(h.buildings.building.floors[0]).toBe(original);
        h.store.dispatch(new AddTile(0, 0, 1, 'Floor', 'copy-only.png'));
        expect(h.buildings.building.floors[0]).toBe(original);
        expect(new Set(h.buildings.building.floors.flatMap(f => f.objects.map(o => o.uid))).size).toBe(4);
        h.destroy();
    });

    it('moves room grids, objects and manual tiles together and preserves the order in TBX', () => {
        const h = setup(), ground = h.buildings.building.floors[0];
        h.store.dispatch(new EditFloor('add', 0)); const empty = h.buildings.building.floors[1];
        h.store.dispatch(new EditFloor('up', 0));
        expect(h.buildings.building.floors).toEqual([empty, ground]); expect(h.grid.getSelectedLevel()).toBe(1);
        expect(h.grid.objects.every(o => o.level === 1)).toBeTrue();
        const reopened = readBuildingFile(writeBuildingFile(h.buildings.building));
        expect(reopened.floors[1].rooms).toBe(ground.rooms);
        expect(reopened.floors[1].tileLayers).toEqual(ground.tileLayers);
        expect(reopened.floors[1].objects.length).toBe(ground.objects.length);
        h.store.dispatch(new Undo()); expect(h.buildings.building.floors).toEqual([ground, empty]);
        expect(h.grid.getSelectedLevel()).toBe(0);
        h.store.dispatch(new Redo()); expect(h.grid.getSelectedLevel()).toBe(1);
        h.store.dispatch(new EditFloor('down', 1)); expect(h.buildings.building.floors).toEqual([ground, empty]);
        h.destroy();
    });

    it('removes a populated floor in one undoable command and selects the floor below', () => {
        const h = setup(); h.store.dispatch(new EditFloor('duplicate', 0));
        const before = h.buildings.building;
        h.store.dispatch(new EditFloor('remove', 1));
        expect(h.buildings.building.floors).toEqual([before.floors[0]]); expect(h.grid.getSelectedLevel()).toBe(0);
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before); expect(h.grid.getSelectedLevel()).toBe(1);
        h.store.dispatch(new Redo()); expect(h.grid.getSelectedLevel()).toBe(0);
        h.destroy();
    });

    it('enforces the native eight-floor limit and rejects invalid edits without creating undo commands', () => {
        const h = setup(), initial = h.state.value;
        for (const op of ['remove', 'up', 'down'] as const) h.store.dispatch(new EditFloor(op, 0));
        h.store.dispatch(new EditFloor('add', -1));
        expect(h.state.value).toBe(initial);
        for (let i = 0; i < 7; i++) h.store.dispatch(new EditFloor('add', i));
        const full = h.state.value;
        h.store.dispatch(new EditFloor('add', 7)); h.store.dispatch(new EditFloor('duplicate', 7));
        expect(h.state.value).toBe(full); expect(h.buildings.building.floors.length).toBe(8);
        h.destroy();
    });
});
