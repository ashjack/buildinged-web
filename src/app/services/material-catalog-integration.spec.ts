import { BehaviorSubject } from 'rxjs';
import { AddRoom, ClearBuilding, Redo, SetBuilding, SetDocumentLocked, SyncBuildingMaterials, Undo } from '../app.actions';
import { Building, TileEntry } from '../models/app.models';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { writeIndexGrid } from '../utils/tbx-grid';
import { BuildingTilesLibraryService } from './building-tiles-library.service';
import { generateBuildingSquares } from './native-squares';
import { WindowService } from './window.service';
import ToolWindow from '../tools/tool-window';

function scenario() {
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    const oldWall: TileEntry = { category: 'exterior_walls', tiles: [
        { enum: 'West', tile: 'walls_house_0' }, { enum: 'North', tile: 'walls_house_1' },
        { enum: 'WestWindow', tile: 'walls_house_8' }, { enum: 'NorthWindow', tile: 'walls_house_9' },
    ] };
    const oldWindow: TileEntry = { category: 'windows', tiles: [
        { enum: 'West', tile: 'custom_windows_000' }, { enum: 'North', tile: 'custom_windows_001' },
    ] };
    const wall: TileEntry = { category: 'exterior_walls', tiles: [
        { enum: 'West', tile: 'walls_house_000' }, { enum: 'North', tile: 'walls_house_001' },
        { enum: 'WestWindow', tile: 'walls_house_008' }, { enum: 'NorthWindow', tile: 'walls_house_009' },
        { enum: 'WestWindow13', tile: 'window_frames_013' }, { enum: 'NorthWindow15', tile: 'window_frames_015' },
    ] };
    const window: TileEntry = { ...oldWindow, tiles: oldWindow.tiles.map((tile, index) => ({ ...tile, windowShape: index ? 15 : 13 })) };
    b.entries = [oldWall, oldWindow]; b.ExteriorWall = 1; b.Window = 2;
    b.ExteriorWallTrim = b.Door = b.DoorFrame = b.Curtains = b.Shutters = b.Stairs = b.RoofCap = b.RoofSlope = b.RoofTop = b.GrimeWall = 0;
    b.rooms = b.rooms.map(room => ({ ...room, InteriorWall: 0, InteriorWallTrim: 0, Floor: 0, GrimeFloor: 0, GrimeWall: 0 }));
    b.floors = [{ rooms: writeIndexGrid([[1, 1], [1, 1]]), objects: [
        { uid: 'west', type: 'window', x: 2, y: 0, dir: 'W', Tile: 2 },
        { uid: 'north', type: 'window', x: 0, y: 2, dir: 'N', Tile: 2 },
    ] }];
    const entries = new BehaviorSubject<TileEntry[]>([]);
    const library = { entries$: entries, load: async () => ({}) } as unknown as BuildingTilesLibraryService;
    const h = documentHarness(b, '', library);
    return { h, entries, wall, window, library };
}

describe('Server materials in loaded buildings and templates', () => {
    it('updates already-placed windows to frames 13 and 15 when the server catalog arrives, and saves the result', () => {
        const { h, entries, wall, window } = scenario();
        const before = h.buildings.building, documentId = h.state.value.documentId;
        entries.next([wall, window]);
        const building = h.buildings.building;
        expect(building.entries).toEqual([wall, window]);
        expect(building.floors).toBe(before.floors);
        expect(h.state.value.documentId).toBe(documentId); expect(h.state.value.past.length).toBe(0);
        expect(h.grid.getTileAt(2, 0, 0, 'Walls')?.name).toBe('window_frames_013.png');
        expect(h.grid.getTileAt(0, 2, 0, 'Walls')?.name).toBe('window_frames_015.png');
        const reopened = readBuildingFile(writeBuildingFile(building));
        const names = generateBuildingSquares(reopened).tiles.map(tile => tile.name);
        expect(names).toContain('window_frames_013.png'); expect(names).toContain('window_frames_015.png');
        h.destroy(); entries.complete();
    });

    it('keeps server definitions authoritative after undo/redo, refresh, and loading the next building', () => {
        const { h, entries, wall, window } = scenario();
        entries.next([wall, window]);
        h.store.dispatch(new AddRoom(0, 0, 0, 0));
        const current = { ...window, tiles: window.tiles.map(tile => ({ ...tile, windowShape: 15 })) };
        entries.next([wall, current]);
        expect(h.state.value.past.length).toBe(1);
        h.store.dispatch(new Undo()); expect(h.buildings.building.entries[1]).toEqual(current);
        expect(h.state.value.past.length).toBe(0); expect(h.state.value.future.length).toBe(1);
        h.store.dispatch(new Redo()); expect(h.buildings.building.entries[1]).toEqual(current);
        const old = h.buildings.building;
        const template: Building = { ...old, entries: old.entries.map(entry => ({ ...entry,
            tiles: entry.tiles.filter(tile => !/Window\d+$/.test(tile.enum || '')).map(({ windowShape, ...tile }) => tile) })) };
        h.store.dispatch(new ClearBuilding()); h.store.dispatch(new SetBuilding(template));
        expect(h.buildings.building.entries[1]).toEqual(current);
        expect(h.buildings.building.entries[0]).toEqual(wall);
        h.store.dispatch(new SyncBuildingMaterials(old, { ...old, entries: [] }));
        expect(h.buildings.building.entries.length).toBe(2);
        h.destroy(); entries.complete();
    });

    it('uses the server frames for the hover preview and for newly placed windows without mutating the document during preview', () => {
        const { h, entries, wall, window } = scenario(); entries.next([wall, window]);
        const b = h.buildings.building, service = new WindowService(h.grid, h.buildings, h.store as any);
        const tool = new ToolWindow(service, h.grid, h.buildings);
        tool.hoverTile(1, 1, 'E');
        expect(tool.previewTiles?.find(tile => tile.x === 2 && tile.y === 1 && tile.layer === 'Walls')?.name).toBe('window_frames_013.png');
        expect(h.buildings.building).toBe(b);
        const preview = tool.previewTiles; tool.hoverTile(1, 1, 'E'); expect(tool.previewTiles).toBe(preview);
        tool.beginDrag(1, 1); tool.hoverTile(1, 1, 'S'); tool.endDrag(1, 1);
        expect(h.grid.getTileAt(1, 2, 0, 'Walls')?.name).toBe('window_frames_015.png');
        tool.cancel(); expect(tool.previewTiles).toBeUndefined();
        h.destroy(); entries.complete();
    });

    it('refreshes material definitions without unlocking a read-only document', () => {
        const { h, entries, wall, window } = scenario(); h.store.dispatch(new SetDocumentLocked(true));
        entries.next([wall, window]);
        expect(h.state.value.documentLocked).toBeTrue(); expect(h.buildings.building.entries[1]).toEqual(window);
        expect(h.state.value.past.length).toBe(0);
        h.destroy(); entries.complete();
    });
});
