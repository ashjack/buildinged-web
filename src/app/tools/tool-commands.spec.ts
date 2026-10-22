import { ElementRef } from '@angular/core';
import { AddObject, AddTile, Redo, SetSelectedFurniture, Undo } from '../app.actions';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { emptyIndexGrid, writeIndexGrid } from '../utils/tbx-grid';
import { DoorService } from '../services/door.service';
import { WindowService } from '../services/window.service';
import { FurnitureService } from '../services/furniture.service';
import { RoofService } from '../services/roof.service';
import { ViewportCanvasComponent } from '../viewport-canvas/viewport-canvas.component';
import ToolDrawRoom from './tool-draw-room';
import ToolTile from './tool-tile';
import ToolFurniture from './tool-furniture';
import ToolRoof from './tool-roof';
import ToolDoor from './tool-door';
import ToolWindow from './tool-window';
import ToolDraw from './tool-draw';

function setup() {
    const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    building.entries[0].tiles.push({ enum: 'North', tile: 'fixtures_doors_01_001' });
    building.entries.push({ category: 'windows', tiles: [{ enum: 'West', tile: 'fixtures_windows_01_008' }, { enum: 'North', tile: 'fixtures_windows_01_009' }] });
    building.Window = 2;
    building.floors = [0, 1].map(() => ({ objects: [], rooms: writeIndexGrid(emptyIndexGrid(2, 2)), tileLayers: [] }));
    const scene = documentHarness(building);
    const furniture = { entries: [{ orient: 'W', xSize: 0, ySize: 0,
        tiles: [{ name: 'furniture_seating_indoor_01_005.png', x: 0, y: 0, url: '', layer: 'Furniture', level: 0 }] }] };
    scene.store.dispatch(new SetSelectedFurniture(furniture, 'W'));
    const doors = new DoorService(scene.grid, scene.buildings, scene.store as any);
    const windows = new WindowService(scene.grid, scene.buildings, scene.store as any);
    const furnitures = new FurnitureService(null!, scene.buildings, scene.store as any);
    const roofs = new RoofService(scene.buildings, scene.grid, scene.store as any);
    const tools: ToolDraw[] = [
        new ToolDrawRoom(scene.rooms, scene.grid, scene.buildings, scene.store as any),
        new ToolTile(scene.grid, scene.store as any), new ToolFurniture(scene.grid, scene.store as any, furnitures),
        new ToolRoof(roofs, scene.grid), new ToolDoor(doors, scene.grid), new ToolWindow(windows, scene.grid, scene.buildings),
    ];
    (tools[4] as ToolDoor).edge = 'W'; (tools[5] as ToolWindow).edge = 'N';
    const view = new ViewportCanvasComponent(null!, null!, scene.store as any, null!, null!, furnitures,
        scene.buildings, scene.grid, scene.rooms, null!, doors, windows, roofs);
    view.canvasElement = new ElementRef(document.createElement('canvas'));
    return { ...scene, tools, doors, windows, furnitures, roofs, furniture, view };
}

function targetedKey(target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers });
    target.dispatchEvent(event);
    return event;
}

describe('Tool edit commands', () => {
    it('requires a complete, uncancelled gesture on the same floor for every tool', () => {
        const scene = setup();
        for (const tool of scene.tools) {
            const before = scene.buildings.building;
            tool.endDrag(0, 0);
            expect(scene.buildings.building).toBe(before);
            tool.beginDrag(0, 0); tool.cancel(); tool.endDrag(0, 0);
            expect(scene.buildings.building).toBe(before);
            scene.grid.setSelectedLevel(0);
            tool.beginDrag(0, 0); scene.grid.setSelectedLevel(1); tool.endDrag(0, 0);
            expect(scene.buildings.building).toBe(before);
        }
        expect(scene.state.value.past.length).toBe(0);
        scene.destroy();
    });

    it('places each tool on the selected floor without needing hover to refresh its cached level', () => {
        const scene = setup();
        scene.grid.setSelectedLevel(1);
        for (const tool of scene.tools) { tool.beginDrag(0, 0); tool.endDrag(0, 0); }
        expect(scene.buildings.building.floors[0].objects.length).toBe(0);
        expect(scene.buildings.building.floors[1].objects.map(object => object.type)).toEqual(['furniture', 'roof', 'door', 'window']);
        expect(scene.state.value.past.length).toBe(6);
        scene.destroy();
    });

    it('normalizes south/east placement repeatedly without changing the hovered edge', () => {
        const scene = setup();
        const door = scene.tools[4] as ToolDoor, window = scene.tools[5] as ToolWindow;
        door.edge = 'S';
        door.clickTile(0, 0); door.clickTile(0, 0);
        window.edge = 'E'; window.clickTile(0, 0); window.clickTile(0, 0);
        expect(scene.buildings.building.floors[0].objects.map(object => [object.x, object.y, object.dir])).toEqual([
            [0, 1, 'N'], [0, 1, 'N'], [1, 0, 'W'], [1, 0, 'W'],
        ]);
        expect(door.edge).toBe('S'); expect(window.edge).toBe('E');
        const before = scene.buildings.building;
        door.edge = ''; door.clickTile(0, 0);
        scene.doors.placeDoor(-1, 0, 0, 'W'); scene.windows.placeWindow(0, 0, 9, 'N');
        expect(scene.buildings.building).toBe(before);
        scene.destroy();
    });

    it('previews configured door/window tiles and safely handles an empty palette', () => {
        const scene = setup();
        scene.tools[4].hoverTile(0, 0, 'W');
        expect(scene.tools[4].tileGhosts[0].name).toBe('fixtures_doors_01_000.png');
        scene.tools[5].hoverTile(0, 0, 'E');
        expect(scene.tools[5].tileGhosts[0].url).toBe('fixtures_windows_01_008.png');
        expect(scene.tools[5].tileGhosts[0].x).toBe(1);
        scene.tools[5].hoverTile(0, 0, '');
        expect(scene.tools[5].tileGhosts).toEqual([]);
        scene.destroy();
    });

    it('Ctrl-erases furniture in one command without placing any or deleting doors, tiles or other floors', () => {
        const scene = setup();
        scene.furnitures.placeFurniture(0, 0, 0, 'W', scene.furniture);
        scene.furnitures.placeFurniture(0, 0, 1, 'W', scene.furniture);
        scene.furnitures.placeFurniture(1, 0, 1, 'W', scene.furniture);
        scene.doors.placeDoor(0, 0, 1, 'W');
        scene.store.dispatch(new AddTile(0, 0, 1, 'Furniture', 'furniture_seating_indoor_01_000.png'));
        const before = scene.buildings.building, historyLength = scene.state.value.past.length;
        scene.grid.setSelectedLevel(1);
        const tool = scene.tools[2]; tool.key = 'Control'; tool.beginDrag(0, 0); tool.endDrag(1, 0);
        expect(scene.state.value.past.length).toBe(historyLength + 1);
        expect(scene.buildings.building.floors[0].objects.length).toBe(1);
        expect(scene.buildings.building.floors[1].objects.map(object => object.type)).toEqual(['door']);
        expect(scene.grid.userTiles.length).toBe(1);
        scene.store.dispatch(new Undo());
        expect(scene.buildings.building).toBe(before);
        scene.store.dispatch(new Redo());
        const saved = readBuildingFile(writeBuildingFile(scene.buildings.building));
        expect(saved.floors[1].objects.map(object => object.type)).toEqual(['door']);
        scene.destroy();
    });

    it('right-click deletes a roof on one floor and undo restores its identity', () => {
        const scene = setup();
        scene.roofs.placeRoof(0, 0, 0, 0, 0, 'PeakNS');
        scene.roofs.placeRoof(0, 0, 1, 0, 0, 'PeakNS');
        const before = scene.buildings.building;
        scene.grid.setSelectedLevel(1);
        scene.view.selectedTool = scene.tools[3];
        scene.view.currentHoverObject = scene.grid.objects.find(o => o.type === 'roof' && o.level === 1);
        scene.view.onMouseDown(new MouseEvent('mousedown', { button: 2 }));
        expect(scene.buildings.building.floors[0].objects.length).toBe(1);
        expect(scene.buildings.building.floors[1].objects.length).toBe(0);
        scene.store.dispatch(new Undo()); expect(scene.buildings.building).toBe(before);
        scene.destroy();
    });

    it('undo/redo switches to the command floor and restores the saved and rendered state', () => {
        const scene = setup();
        const tool = scene.tools[1] as ToolTile;
        scene.grid.setSelectedLevel(1); tool.beginDrag(0, 0); tool.endDrag(1, 1);
        const placed = scene.buildings.building;
        scene.grid.setSelectedLevel(0); scene.store.dispatch(new Undo());
        expect(scene.grid.getSelectedLevel()).toBe(1); expect(scene.grid.userTiles.length).toBe(0);
        scene.store.dispatch(new Redo());
        expect(scene.buildings.building).toBe(placed); expect(scene.grid.userTiles.length).toBe(4);
        scene.destroy();
    });

    it('right-click cancels a drag, then deletes by UID only on the selected floor', () => {
        const scene = setup();
        const add = new AddObject({ type: 'door', x: 0, y: 0, dir: 'W', Tile: 1, FrameTile: 0 }, 0);
        scene.store.dispatch(add);
        scene.view.selectedTool = scene.tools[1]; scene.view.currentHoverObject = scene.grid.objects[0];
        scene.tools[1].beginDrag(0, 0);
        scene.view.onMouseDown(new MouseEvent('mousedown', { button: 2 }));
        scene.tools[1].endDrag(1, 1);
        expect(scene.buildings.building.floors[0].objects.length).toBe(1);
        expect(scene.state.value.past.length).toBe(1);
        scene.view.selectedTool = scene.tools[4]; // Object tools retain right-click deletion; tile tools now capture patterns.
        scene.view.currentHoverObject = scene.grid.objects[0]; scene.grid.setSelectedLevel(1);
        scene.view.onMouseDown(new MouseEvent('mousedown', { button: 2 }));
        expect(scene.buildings.building.floors[0].objects.length).toBe(1);
        scene.grid.setSelectedLevel(0); scene.view.currentHoverObject = scene.grid.objects[0];
        scene.view.onMouseDown(new MouseEvent('mousedown', { button: 2 }));
        expect(scene.buildings.building.floors[0].objects.length).toBe(0);
        scene.store.dispatch(new Undo()); expect(scene.grid.objects[0].uid).toBe(add.obj.uid);
        scene.destroy();
    });

    it('cancels release outside the canvas and Escape without creating an edit', () => {
        const scene = setup(); scene.view.selectedTool = scene.tools[1];
        scene.tools[1].beginDrag(0, 0);
        const release = new MouseEvent('mouseup', { button: 0 }); document.createElement('div').dispatchEvent(release);
        scene.view.onMouseUp(release);
        expect(scene.tools[1].isDragging).toBeFalse(); expect(scene.state.value.past.length).toBe(0);
        scene.tools[1].beginDrag(0, 0);
        scene.view.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
        scene.tools[1].endDrag(1, 1); expect(scene.state.value.past.length).toBe(0);
        scene.destroy();
    });

    it('supports history shortcuts and Delete while leaving text-field editing to the browser', () => {
        const scene = setup();
        scene.store.dispatch(new AddTile(0, 0, 0, 'Walls', 'walls_exterior_house_01_000.png'));
        scene.view.handleKeyDown(targetedKey(document.createElement('input'), 'z', { ctrlKey: true }));
        expect(scene.state.value.past.length).toBe(1);
        scene.view.handleKeyDown(targetedKey(document.createElement('canvas'), 'z', { ctrlKey: true }));
        expect(scene.state.value.past.length).toBe(0);
        scene.view.handleKeyDown(targetedKey(document.createElement('canvas'), 'z', { metaKey: true, shiftKey: true }));
        expect(scene.state.value.past.length).toBe(1);
        scene.doors.placeDoor(0, 0, 0, 'W'); scene.view.currentHoverObject = scene.grid.objects[0];
        scene.view.handleKeyDown(targetedKey(document.createElement('textarea'), 'Delete'));
        expect(scene.grid.objects.length).toBe(1);
        scene.view.handleKeyDown(targetedKey(document.createElement('canvas'), 'Delete'));
        expect(scene.grid.objects.length).toBe(0);
        scene.destroy();
    });
});
