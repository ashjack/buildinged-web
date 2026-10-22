import { of } from 'rxjs';
import { AddObject, AddTile, EditRooms, PaintTileCells, Redo, SetBuilding, SetCurrentTool, TransformSelection, Undo } from '../app.actions';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { emptyIndexGrid, readIndexGrid, writeIndexGrid } from '../utils/tbx-grid';
import { ToolSettingsService } from '../services/tool-settings.service';
import { ViewportCanvasComponent } from '../viewport-canvas/viewport-canvas.component';
import ToolSelect from './tool-select';
import ToolWall from './tool-wall';
import ToolStairs from './tool-stairs';
import ToolTile from './tool-tile';

function setup() {
    localStorage.clear();
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    b.width = b.height = 8;
    b.entries.push({ category: 'floors', tiles: [{ enum: 'Floor', tile: 'floor' }] },
        { category: 'interior_walls', tiles: ['West', 'North', 'NorthWest', 'SouthEast'].map(name => ({ enum: name, tile: 'wall-' + name })) },
        { category: 'stairs', tiles: ['North1', 'North2', 'North3', 'West1', 'West2', 'West3'].map(name => ({ enum: name, tile: name })) });
    b.rooms[0].Floor = 2; b.rooms[0].InteriorWall = 3; b.ExteriorWall = 3; b.Stairs = 4;
    b.floors = [0, 1].map(() => ({ rooms: writeIndexGrid(emptyIndexGrid(8, 8)), objects: [], tileLayers: [] }));
    const h = documentHarness(b), settings = new ToolSettingsService();
    return { ...h, settings,
        select: (mode: 'objects' | 'rooms' | 'tiles') => new ToolSelect(mode, h.grid, h.buildings, h.store as any, settings),
        wall: new ToolWall(h.buildings, h.grid, h.store as any, settings),
        stairs: new ToolStairs(h.buildings, h.grid, h.store as any, settings),
        tile: new ToolTile(h.grid, h.store as any, settings) };
}

describe('Selection and movement tools', () => {
    it('selects by UID, adds/subtracts objects, moves a group once, and restores it on undo', () => {
        const h = setup();
        for (const [uid, x] of [['a', 1], ['b', 2]] as const) h.store.dispatch(new AddObject({ uid, type: 'door', x, y: 1, dir: 'W', Tile: 1 }, 0));
        h.store.dispatch(new AddObject({ uid: 'other-floor', type: 'door', x: 1, y: 1, dir: 'W', Tile: 1 }, 1));
        const tool = h.select('objects'); tool.clickTile(1, 1);
        expect(tool.uids).toEqual(['a']);
        tool.modifiers.shift = true; tool.clickTile(2, 1); expect(tool.uids).toEqual(['a', 'b']);
        tool.modifiers = { ctrl: true, shift: false, alt: false }; tool.clickTile(1, 1); expect(tool.uids).toEqual(['b']);
        tool.modifiers = { ctrl: false, shift: true, alt: false }; tool.clickTile(1, 1);
        tool.modifiers.shift = false;
        const before = h.buildings.building, commands = h.state.value.past.length;
        tool.beginDrag(1, 1); tool.hoverTile(3, 2); tool.endDrag(3, 2);
        expect(h.state.value.past.length).toBe(commands + 1);
        expect(h.buildings.building.floors[0].objects.map(o => [o.uid, o.x, o.y])).toEqual([['a', 3, 2], ['b', 4, 2]]);
        expect(h.buildings.building.floors[1].objects[0].x).toBe(1);
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); expect(h.buildings.building.floors[0].objects[0].uid).toBe('a');
        expect(tool.deleteSelection()).toBeTrue(); expect(h.buildings.building.floors[0].objects.length).toBe(0);
        h.destroy();
    });

    it('rejects an entire group move when one full object footprint would leave the document', () => {
        const h = setup();
        h.store.dispatch(new AddObject({ uid: 'stairs', type: 'stairs', x: 3, y: 1, dir: 'W', Tile: 4 }, 0));
        h.store.dispatch(new AddObject({ uid: 'door', type: 'door', x: 1, y: 1, dir: 'W', Tile: 1 }, 0));
        const before = h.buildings.building, commands = h.state.value.past.length;
        h.store.dispatch(new TransformSelection({ mode: 'objects', level: 0, uids: ['stairs', 'door'], dx: 2, dy: 0 }));
        expect(h.buildings.building).toBe(before); expect(h.state.value.past.length).toBe(commands);
        h.destroy();
    });

    it('moves overlapping room areas from snapshots, including every floor and objects with Ctrl+Shift', () => {
        const h = setup();
        h.store.dispatch(new EditRooms({ x: 1, y: 1, width: 2, height: 1 }, 0, 1));
        h.store.dispatch(new EditRooms({ x: 1, y: 1, width: 1, height: 1 }, 1, 1));
        h.store.dispatch(new AddObject({ uid: 'door', type: 'door', x: 1, y: 1, dir: 'N', Tile: 1 }, 1));
        h.grid.setSelectedLevel(1);
        const tool = h.select('rooms'); tool.beginDrag(1, 1); tool.endDrag(2, 1);
        const before = h.buildings.building, commands = h.state.value.past.length;
        tool.modifiers = { ctrl: true, shift: true, alt: false };
        tool.beginDrag(1, 1); tool.endDrag(2, 1);
        expect(h.state.value.past.length).toBe(commands + 1);
        expect(readIndexGrid(h.buildings.building.floors[0].rooms, 8, 8)[1].slice(1, 4)).toEqual([0, 1, 1]);
        expect(readIndexGrid(h.buildings.building.floors[1].rooms, 8, 8)[1].slice(1, 4)).toEqual([0, 1, 0]);
        expect(h.buildings.building.floors[1].objects[0].x).toBe(2);
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before); expect(h.grid.getSelectedLevel()).toBe(1);
        h.destroy();
    });

    it('moves and deletes only manual tiles on the chosen floor and layer, preserving generated room floors', () => {
        const h = setup(); localStorage.setItem('selectedLayer', 'Floor');
        h.store.dispatch(new EditRooms({ x: 1, y: 1, width: 4, height: 1 }, 0, 1));
        h.store.dispatch(new AddTile(1, 1, 0, 'Floor', 'custom.png'));
        h.store.dispatch(new AddTile(2, 1, 0, 'Floor', 'different.png'));
        h.store.dispatch(new AddTile(1, 1, 0, 'Walls', 'wall.png'));
        const tool = h.select('tiles'); tool.beginDrag(1, 1); tool.endDrag(2, 1);
        tool.beginDrag(1, 1); tool.endDrag(2, 1);
        expect(h.grid.getTileAt(1, 1, 0, 'Floor')?.name).toBe('floor.png');
        expect(h.grid.getTileAt(2, 1, 0, 'Floor')?.name).toBe('custom.png');
        expect(h.grid.getTileAt(3, 1, 0, 'Floor')?.name).toBe('different.png');
        expect(h.grid.getTileAt(1, 1, 0, 'Walls')?.name).toBe('wall.png');
        tool.deleteSelection(); expect(h.grid.getTileAt(2, 1, 0, 'Floor')?.name).toBe('floor.png');
        h.destroy();
    });

    it('cancels incomplete moves on floor change and lets arrow keys nudge selections', () => {
        const h = setup(); h.store.dispatch(new AddObject({ uid: 'door', type: 'door', x: 1, y: 1, dir: 'W', Tile: 1 }, 0));
        const tool = h.select('objects'); tool.clickTile(1, 1);
        expect(tool.keyDown('ArrowRight')).toBeTrue(); expect(h.buildings.building.floors[0].objects[0].x).toBe(2);
        const before = h.buildings.building;
        tool.beginDrag(2, 1); h.grid.setSelectedLevel(1); tool.endDrag(4, 1);
        expect(h.buildings.building).toBe(before); h.destroy();
    });
});

describe('Wall and stairs tools', () => {
    it('previews a small green intersection cursor and thin wall strips instead of whole grid squares', () => {
        const h = setup(), tool = h.wall;
        tool.pointerPosition = { x: 2.51, y: 3.49 }; tool.hoverTile(2, 3);
        expect(tool.dragTiles).toEqual([]);
        [{ x: 2.8, y: 2.8 }, { x: 3.2, y: 2.8 }, { x: 3.2, y: 3.2 }, { x: 2.8, y: 3.2 }].forEach((p, i) => {
            expect(tool.overlays[0].points[i].x).toBeCloseTo(p.x, 8); expect(tool.overlays[0].points[i].y).toBeCloseTo(p.y, 8);
        });
        tool.beginDrag(2, 3);
        tool.pointerPosition = { x: 6.1, y: 3.1 }; tool.hoverTile(6, 3);
        expect(tool.dragTiles).toEqual([]);
        expect(tool.overlays[0].points[1].x - tool.overlays[0].points[0].x).toBe(3);
        expect(tool.overlays[0].points[2].y - tool.overlays[0].points[1].y).toBeCloseTo(0.4);
        tool.endDrag(6, 3);
        expect(h.buildings.building.floors[0].objects[0].length).toBe(3); h.destroy();
    });

    it('hits actual wall handles, clamps resize to one tile, and prevents crossing the opposite endpoint', () => {
        const h = setup(), tool = h.wall;
        tool.beginDrag(2, 2); tool.endDrag(5, 2);
        const uid = h.buildings.building.floors[0].objects[0].uid;
        tool.pointerPosition = { x: 2.1, y: 2.05 }; tool.hoverTile(2, 2);
        expect(tool.cursor).toBe('move'); expect(tool.overlays.some(o => o.fill === '#fff')).toBeTrue();
        tool.beginDrag(2, 2);
        tool.pointerPosition = { x: 7.1, y: 2.05 }; tool.hoverTile(7, 2); tool.endDrag(7, 2);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ uid, x: 4, y: 2, length: 1 }));
        h.store.dispatch(new Undo());
        tool.pointerPosition = { x: 4.9, y: 2.05 }; tool.hoverTile(4, 2); tool.beginDrag(4, 2);
        tool.pointerPosition = { x: 1.1, y: 2.05 }; tool.hoverTile(1, 2); tool.endDrag(1, 2);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ uid, x: 2, y: 2, length: 1 })); h.destroy();
    });

    it('automatically chooses each stair orientation and places once on mouse-down, freezing it until release', () => {
        const h = setup();
        for (const edge of ['N', 'E', 'W', 'S']) {
            h.stairs.hoverTile(1, 1, edge);
            const expected = edge === 'N' || edge === 'E' ? 'W' : 'N';
            expect(h.stairs.tileGhosts.every(t => t.name?.startsWith(expected === 'W' ? 'West' : 'North'))).toBeTrue();
            const count = h.buildings.building.floors[0].objects.length;
            h.stairs.beginDrag(1, 1);
            expect(h.buildings.building.floors[0].objects.length).toBe(count + 1);
            expect(h.buildings.building.floors[0].objects[count].dir).toBe(expected);
            h.stairs.hoverTile(2, 2, edge === 'N' ? 'W' : 'N'); h.stairs.endDrag(2, 2);
            expect(h.buildings.building.floors[0].objects.length).toBe(count + 1);
            expect(h.buildings.building.floors[0].objects[count]).toEqual(jasmine.objectContaining({ x: 1, y: 1, dir: expected }));
        }
        const before = h.buildings.building;
        h.stairs.hoverTile(4, 1, 'N'); h.stairs.clickTile(4, 1); // X=8 is the outside border, not a stair square.
        expect(h.buildings.building).toBe(before); h.destroy();
    });
    it('draws both wall directions and resizes the same UID with one undoable edit', () => {
        const h = setup(), tool = h.wall;
        tool.beginDrag(1, 1); tool.hoverTile(4, 1); tool.endDrag(4, 1);
        const first = h.buildings.building.floors[0].objects[0];
        expect([first.x, first.y, first.dir, first.length]).toEqual([1, 1, 'W', 3]);
        expect(h.grid.roomTiles.some(t => t.layer === 'Walls' && t.name === 'wall-North.png')).toBeTrue();
        const before = h.buildings.building, commands = h.state.value.past.length;
        tool.beginDrag(4, 1); tool.hoverTile(6, 1); tool.endDrag(6, 1);
        expect(h.buildings.building.floors[0].objects[0].uid).toBe(first.uid);
        expect(h.buildings.building.floors[0].objects[0].length).toBe(5);
        expect(h.state.value.past.length).toBe(commands + 1);
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        tool.beginDrag(5, 3); tool.endDrag(5, 6);
        expect(h.buildings.building.floors[0].objects[1].dir).toBe('N');
        h.destroy();
    });

    it('supports None wall faces, material picking, and gesture cancellation', () => {
        const h = setup(), tool = h.wall;
        h.settings.exterior = 0; h.settings.interior = 0;
        tool.beginDrag(2, 2); tool.endDrag(4, 2);
        const o = h.buildings.building.floors[0].objects[0]; expect(o.Tile).toBe(0); expect(o.InteriorTile).toBe(0);
        h.settings.exterior = 3; tool.modifiers.alt = true; tool.clickTile(2, 2); expect(h.settings.exterior).toBe(0);
        tool.modifiers.alt = false;
        const before = h.buildings.building;
        tool.beginDrag(4, 2); tool.hoverTile(7, 2); tool.cancel(); tool.endDrag(7, 2);
        expect(h.buildings.building).toBe(before); h.destroy();
    });

    it('orients stairs from the hovered edge, rejects invalid footprints, and regenerates holes on the floor above', () => {
        const h = setup(); h.store.dispatch(new EditRooms({ x: 0, y: 0, width: 8, height: 8 }, 1, 1));
        h.grid.setSelectedLevel(0); h.stairs.hoverTile(1, 1, 'N'); h.stairs.clickTile(1, 1);
        const o = h.buildings.building.floors[0].objects[0]; expect(o.dir).toBe('W');
        expect(h.grid.roomTiles.filter(t => t.object === o.uid && t.layer.startsWith('Furniture')).length).toBe(3);
        expect(h.grid.getTileAt(2, 1, 1, 'Floor')).toBeUndefined();
        const before = h.buildings.building; h.stairs.clickTile(7, 7); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Undo()); expect(h.grid.getTileAt(2, 1, 1, 'Floor')?.name).toBe('floor.png');
        h.store.dispatch(new Redo());
        expect(readBuildingFile(writeBuildingFile(h.buildings.building)).floors[0].objects[0].dir).toBe('W'); h.destroy();
    });
});

describe('Manual tile editing tools', () => {
    it('cancels brush strokes and ignores out-of-bounds/no-op edits without clearing redo', () => {
        const h = setup(); h.settings.tileMode = 'brush';
        const before = h.buildings.building;
        h.tile.beginDrag(1, 1); h.tile.hoverTile(5, 1); h.tile.cancel(); h.tile.endDrag(5, 1);
        expect(h.buildings.building).toBe(before);
        h.tile.clickTile(1, 1); h.store.dispatch(new Undo());
        h.store.dispatch(new PaintTileCells(0, 'Floor', [{ x: -1, y: 0, tile: 'ignored' }]));
        expect(h.state.value.future.length).toBe(1); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); expect(h.grid.userTiles.length).toBe(1); h.destroy();
    });
    it('draws a continuous brush stroke across skipped mouse cells with one undo command', () => {
        const h = setup(); h.settings.tileMode = 'brush';
        const before = h.buildings.building;
        h.tile.beginDrag(1, 1); h.tile.hoverTile(5, 1); h.tile.endDrag(5, 1);
        expect(h.grid.userTiles.length).toBe(5); expect(h.state.value.past.length).toBe(1);
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); expect(h.grid.userTiles.length).toBe(5);
        h.settings.tileMode = 'eraser'; h.tile.beginDrag(2, 1); h.tile.endDrag(4, 1);
        expect(h.grid.userTiles.map(t => t.x)).toEqual([1, 5]); h.destroy();
    });

    it('picks generated floor tiles without modifying the document', () => {
        const h = setup(); localStorage.setItem('selectedLayer', 'Floor'); h.settings.tileMode = 'pick';
        h.store.dispatch(new EditRooms({ x: 1, y: 1, width: 1, height: 1 }, 0, 1));
        const before = h.buildings.building; h.tile.clickTile(1, 1);
        expect(localStorage.getItem('selectedTile')).toBe('floor.png'); expect(h.buildings.building).toBe(before); h.destroy();
    });

    it('flood-fills matching connected squares without crossing a different tile', () => {
        const h = setup(); localStorage.setItem('selectedLayer', 'Floor'); localStorage.setItem('selectedTile', 'replacement.png');
        h.store.dispatch(new PaintTileCells(0, 'Floor', [0, 1, 2].map(x => ({ x, y: 1, tile: x === 1 ? 'barrier' : 'source' }))));
        h.settings.tileMode = 'fill'; h.tile.clickTile(0, 1);
        expect(h.grid.getTileAt(0, 1, 0, 'Floor')?.name).toBe('replacement.png');
        expect(h.grid.getTileAt(1, 1, 0, 'Floor')?.name).toBe('barrier.png');
        expect(h.grid.getTileAt(2, 1, 0, 'Floor')?.name).toBe('source.png'); h.destroy();
    });

    it('captures sparse manual tiles, stamps without painting gaps, clips at the border, and survives export', () => {
        const h = setup(); localStorage.setItem('selectedLayer', 'Floor');
        h.store.dispatch(new AddTile(0, 0, 0, 'Floor', 'left.png')); h.store.dispatch(new AddTile(2, 0, 0, 'Floor', 'right.png'));
        const before = h.buildings.building;
        h.tile.beginCapture(0, 0); h.tile.endDrag(2, 0);
        expect(h.buildings.building).toBe(before); expect(h.settings.stamp?.cells.length).toBe(2);
        h.tile.clickTile(7, 2);
        expect(h.grid.getTileAt(7, 2, 0, 'Floor')?.name).toBe('left.png');
        expect(h.grid.getTileAt(8, 2, 0, 'Floor')).toBeUndefined();
        const saved = readBuildingFile(writeBuildingFile(h.buildings.building));
        h.store.dispatch(new SetBuilding(saved)); expect(h.grid.getTileAt(7, 2, 0, 'Floor')?.name).toBe('left.png'); h.destroy();
    });
});

describe('Canvas tool wiring', () => {
    it('updates within-cell stair facing and wall-handle hover using fractional pointer positions', () => {
        const h = setup();
        const view = new ViewportCanvasComponent(null!, null!, h.store as any, null!, null!, null!, h.buildings, h.grid, h.rooms, null!, null!, null!, null!, h.settings);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 200;
        spyOn(canvas, 'getBoundingClientRect').and.returnValue({ left: 0, top: 0, right: 200, bottom: 200 } as DOMRect);
        (view as any).ctx = { canvas };
        spyOn(view, 'drawCanvas').and.stub();
        view.newPositions = [{ localPoint: { x: 2, y: 2 }, point: [{ x: 100, y: 200 }, { x: 200, y: 150 }, { x: 100, y: 100 }, { x: 0, y: 150 }] }];
        view.selectedTool = h.stairs;
        view.getMousePos(new MouseEvent('mousemove', { clientX: 90, clientY: 125 }));
        expect(h.stairs.tileGhosts[0].name).toBe('North3.png');
        view.getMousePos(new MouseEvent('mousemove', { clientX: 110, clientY: 125 }));
        expect(h.stairs.tileGhosts[0].name).toBe('West3.png');
        expect(view.currentHoverCoords).toEqual({ x: 2, y: 2 });
        h.wall.beginDrag(2, 2); h.wall.endDrag(5, 2); view.selectedTool = h.wall;
        view.getMousePos(new MouseEvent('mousemove', { clientX: 129, clientY: 125 }));
        expect(h.wall.cursor).toBe('move');
        view.getMousePos(new MouseEvent('mousemove', { clientX: 131, clientY: 126 }));
        expect(h.wall.cursor).toBe('crosshair'); // Still the same cell, nearest edge and snapped corner.
        h.destroy();
    });
    it('activates all new tools through the store and protects input shortcuts', () => {
        const h = setup();
        const view = new ViewportCanvasComponent({ get: () => of([]) } as any, null!, h.store as any, null!,
            { tilepacks: [], processTilepacks: () => {} } as any, null!, h.buildings, h.grid, h.rooms, null!, null!, null!, null!, h.settings);
        view.ngOnInit();
        for (const [id, type] of [['tool-select-objects', ToolSelect], ['tool-select-rooms', ToolSelect], ['tool-select-tiles', ToolSelect], ['tool-wall', ToolWall], ['tool-stairs', ToolStairs]] as const) {
            h.store.dispatch(new SetCurrentTool(id)); expect(view.selectedTool instanceof type).toBeTrue();
        }
        view.selectedTool.hoverTile(1, 1, 'N');
        const ghosts = [...view.selectedTool.tileGhosts];
        const input = document.createElement('input'), event = new KeyboardEvent('keydown', { key: 'r' });
        input.dispatchEvent(event); view.handleKeyDown(event);
        expect(view.selectedTool.tileGhosts).toEqual(ghosts);
        view.ngOnDestroy(); h.destroy();
    });
});
