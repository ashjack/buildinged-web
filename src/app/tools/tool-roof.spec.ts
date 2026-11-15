import { AddObject, AddTile, Redo, Undo } from '../app.actions';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { documentHarness } from '../testing/document-harness';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { emptyIndexGrid, writeIndexGrid } from '../utils/tbx-grid';
import { nativeRoofHalfDepth, nativeRoofHandles, nativeRoofPreview, resizeNativeRoof } from '../utils/native-roof';
import { RoofService } from '../services/roof.service';
import ToolRoof from './tool-roof';
import { compoundRoofContains } from '../services/compound-roof';

function setup() {
    localStorage.clear();
    const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    b.width = b.height = 12;
    const entries = (category: string, names: string[]) => ({ category, tiles: names.map(name => ({ enum: name, tile: name })) });
    b.entries.push(entries('roof_caps', ['CapGapE1', 'CapGapS1', 'CapGapE2', 'CapGapS2', 'CapGapE3', 'CapGapS3', 'PeakPt5S', 'PeakPt5E']),
        entries('roof_slopes', ['SlopePt5E', 'SlopeE1', 'SlopeE2', 'SlopeE3', 'SlopePt5S', 'SlopeS1', 'SlopeS2', 'SlopeS3', 'SlopeOnePt5E', 'SlopeTwoPt5E']),
        entries('roof_tops', ['West1', 'West2', 'West3']));
    b.RoofCap = 2; b.RoofSlope = 3; b.RoofTop = 4;
    b.floors = [0, 1].map(() => ({ rooms: writeIndexGrid(emptyIndexGrid(12, 12)), objects: [], tileLayers: [] }));
    const h = documentHarness(b), roofs = new RoofService(h.buildings, h.grid, h.store as any), tool = new ToolRoof(roofs, h.grid);
    const add = (type = 'FlatTop', width = 4, height = 4, level = 0) => {
        const o = resizeNativeRoof(roofs.createObject(2, 2, type), width, height, false);
        h.store.dispatch(new AddObject(o, level)); return o;
    };
    const point = (x: number, y: number) => { tool.pointerPosition = { x, y }; tool.hoverTile(Math.floor(x), Math.floor(y)); };
    const click = (x: number, y: number) => { point(x, y); tool.clickTile(Math.floor(x), Math.floor(y)); };
    return { ...h, roofs, tool, add, point, click };
}

describe('Native roof mouse interactions', () => {
    for (const id of ['l-roof', 'l-roof30', 't-roof', 't-roof30']) {
        it(`places the four entered ${id} dimensions on a click and keeps lengths attached when rotated`, () => {
            const h = setup(); h.roofs.setSelectedRoofOptionId(id);
            h.roofs.configureDimension('mainLength', 9); h.roofs.configureDimension('returnLength', 8);
            h.roofs.configureDimension('mainWidth', 5); h.roofs.configureDimension('returnWidth', 3);
            expect(h.roofs.compoundDimensions).toEqual({ mainLength: 9, mainWidth: 5, returnLength: 8, returnWidth: 3 });
            h.point(1.2, 1.2); h.tool.beginDrag(1, 1); h.point(1.3, 1.3); h.tool.endDrag(1, 1);
            const object = h.buildings.building.floors[0].objects[0];
            expect(object).toEqual(jasmine.objectContaining({ width: 9, height: 8, RoofMainWidth: 5, RoofReturnWidth: 3 }));
            h.roofs.configureDimension('mainLength', 10); h.roofs.configureDimension('returnLength', 9);
            const beforeRotation = h.buildings.building;
            h.roofs.configureCompound('RoofRotation', 1);
            expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ uid: object.uid, width: 9, height: 10 }));
            expect(h.roofs.compoundDimensions).toEqual({ mainLength: 10, mainWidth: 5, returnLength: 9, returnWidth: 3 });
            const rotated = h.buildings.building;
            h.roofs.configureDimension('mainLength', 2); expect(h.buildings.building).toBe(rotated); expect(h.roofs.message).toContain('Main length must be');
            h.roofs.configureDimension('returnLength', 256); expect(h.buildings.building).toBe(rotated); expect(h.roofs.message).toContain('outside the building');
            h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(beforeRotation); h.store.dispatch(new Redo());
            const saved = readBuildingFile(writeBuildingFile(h.buildings.building)).floors[0].objects[0];
            expect([+saved.width, +saved.height, +saved.RoofMainWidth, +saved.RoofReturnWidth, +saved.RoofRotation]).toEqual([9, 10, 5, 3, 1]);
            const next = new RoofService(h.buildings, h.grid, h.store as any).createObject(0, 0, object.RoofType);
            expect([next.width, next.height]).toEqual([9, 10]);
            h.destroy();
        });
    }
    it('allows a drag to replace the preset lengths while preserving independent wing widths', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('l-roof30');
        h.roofs.configureDimension('mainLength', 9); h.roofs.configureDimension('returnLength', 8);
        h.roofs.configureDimension('mainWidth', 3); h.roofs.configureDimension('returnWidth', 2);
        h.point(1.2, 1.2); h.tool.beginDrag(1, 1); h.point(6.2, 7.2); h.tool.endDrag(6, 7);
        expect(h.roofs.compoundDimensions).toEqual({ mainLength: 6, mainWidth: 3, returnLength: 7, returnWidth: 2 }); h.destroy();
    });
    it('offers and remembers one-tile width increments without rounding odd widths on edit, undo or reload', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('l-roof30');
        expect(h.roofs.compoundWingOptions.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        h.add('LRoof30', 8, 8); h.click(7.2, 3.2);
        const before = h.buildings.building;
        h.roofs.configureCompound('RoofMainWidth', 5); h.roofs.configureCompound('RoofReturnWidth', 3);
        expect(h.roofs.editingRoof).toEqual(jasmine.objectContaining({ RoofMainWidth: 5, RoofReturnWidth: 3 }));
        const next = new RoofService(h.buildings, h.grid, h.store as any).createObject(0, 0, 'LRoof30');
        expect(next).toEqual(jasmine.objectContaining({ RoofMainWidth: 5, RoofReturnWidth: 3, width: 4, height: 6 }));
        h.store.dispatch(new Undo()); h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); h.store.dispatch(new Redo());
        const saved = readBuildingFile(writeBuildingFile(h.buildings.building)).floors[0].objects[0];
        expect([+saved.RoofMainWidth, +saved.RoofReturnWidth]).toEqual([5, 3]); h.destroy();
    });
    it('edits and remembers independent L-wing widths, expands only the necessary dimensions, and rejects out-of-bounds sizes', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('l-roof');
        const roof = h.add('LRoof', 8, 8); h.click(7.2, 3.2);
        const before = h.buildings.building;
        h.roofs.configureCompound('RoofMainWidth', 10);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ uid: roof.uid, RoofMainWidth: 10, RoofReturnWidth: 0, width: 8, height: 11 }));
        h.roofs.configureCompound('RoofReturnWidth', 8);
        const after = h.buildings.building;
        expect(after.floors[0].objects[0]).toEqual(jasmine.objectContaining({ RoofMainWidth: 10, RoofReturnWidth: 8, width: 9, height: 11 }));
        h.roofs.configureCompound('RoofMainWidth', 254);
        expect(h.buildings.building).toBe(after); expect(h.roofs.message).toContain('outside the building');
        const next = new RoofService(h.buildings, h.grid, h.store as any).createObject(0, 0, 'LRoof30');
        expect(next).toEqual(jasmine.objectContaining({ RoofMainWidth: 10, RoofReturnWidth: 8, width: 9, height: 11 }));
        h.store.dispatch(new Undo()); h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo()); h.store.dispatch(new Redo()); expect(h.buildings.building).toBe(after);
        h.destroy();
    });
    it('keeps a compound roof selected when leaving the grid and regenerating its tiles after a settings edit', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('l-roof');
        const roof = h.add('LRoof', 8, 8);
        // The viewport cancels pointer gestures when a document edit regenerates the projection.
        const changes = h.state.subscribe(() => h.tool.cancel());
        h.click(7.2, 3.2); h.tool.clearHover();
        expect(h.roofs.editingRoofId).toBe(roof.uid);
        expect(h.tool.overlays).toEqual([]);
        h.roofs.configureCompound('RoofMainWidth', 6);
        expect(h.roofs.editingRoofId).toBe(roof.uid);
        h.roofs.configureCompound('RoofRotation', 1);
        h.roofs.configureCompound('RoofMirror', true);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ RoofMainWidth: 6, RoofRotation: 1, RoofMirror: true }));
        expect(h.buildings.building.floors[0].objects.length).toBe(1);
        h.tool.cancel(); expect(h.roofs.editingRoofId).toBeUndefined();
        changes.unsubscribe(); h.destroy();
    });
    for (const id of ['l-roof', 't-roof', 'l-roof30', 't-roof30']) {
        it(`places, selects and resizes ${id} with one undo command per edit`, () => {
            const h = setup(); h.roofs.setSelectedRoofOptionId(id);
            h.point(1.2, 1.2); h.tool.beginDrag(1, 1); h.point(8.7, 10.7);
            expect(h.tool.overlays[0].points.length).toBe(id.startsWith('l-') ? 6 : 8);
            expect(h.buildings.building.floors[0].objects.length).toBe(0);
            h.tool.endDrag(8, 10);
            const object = h.buildings.building.floors[0].objects[0], before = h.buildings.building;
            expect(object).toEqual(jasmine.objectContaining({ width: 8, height: 10, RoofRotation: 0, RoofMirror: false, RoofWingWidth: 0 }));
            h.click(7.2, 2.2); // Header interior: select without adding a second roof.
            expect(h.buildings.building.floors[0].objects.length).toBe(1);
            expect(h.roofs.editingRoofId).toBe(object.uid);
            h.point(11.2, 11.2); // Keep selection while moving to the settings panel.
            expect(h.roofs.editingRoofId).toBe(object.uid);
            h.roofs.configureCompound('RoofMirror', true);
            expect(h.buildings.building.floors[0].objects[0].RoofMirror).toBeTrue();
            h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
            h.point(8.75, 10.75); h.tool.beginDrag(8, 10); h.point(9.75, 10.75); h.tool.endDrag(9, 10);
            expect(h.buildings.building.floors[0].objects[0].width).toBe(9);
            h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before); h.store.dispatch(new Redo());
            const saved = readBuildingFile(writeBuildingFile(h.buildings.building)).floors[0].objects[0];
            expect(saved.RoofType).toBe(object.RoofType); expect(Number(saved.width)).toBe(9);
            expect(compoundRoofContains({ ...saved, x: +saved.x, y: +saved.y, width: +saved.width, height: +saved.height, roofType: saved.RoofType }, { x: 1.5, y: 9.5 })).toBeFalse();
            h.destroy();
        });
    }
    for (const id of ['peak30-vertical', 'peak30-horizontal', 'peak30-quad', 'dormer30-w', 'dormer30-e', 'dormer30-n', 'dormer30-s']) {
        it(`keeps an even ${id} footprint during placement, preview and save/reopen`, () => {
            const h = setup(); h.roofs.setSelectedRoofOptionId(id);
            h.point(2.2, 2.2); h.tool.beginDrag(2, 2); h.point(5.2, 5.2);
            expect(h.tool.statusText).toContain('Width,Height = 4,4');
            expect(h.buildings.building.floors[0].objects.length).toBe(0);
            h.tool.endDrag(5, 5);
            const o = h.buildings.building.floors[0].objects[0];
            expect(o).toEqual(jasmine.objectContaining({ x: 2, y: 2, width: 4, height: 4 }));
            const reopened = readBuildingFile(writeBuildingFile(h.buildings.building)).floors[0].objects[0];
            expect(Number(reopened.width)).toBe(4); expect(Number(reopened.height)).toBe(4);
            h.destroy();
        });
    }
    it('creates and resizes a 30-degree peak, preserves its type through undo and save/reopen', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('peak30-vertical');
        h.point(2.2, 2.2); h.tool.beginDrag(2, 2); h.point(5.2, 4.2); h.tool.endDrag(5, 4);
        const before = h.buildings.building;
        expect(before.floors[0].objects[0]).toEqual(jasmine.objectContaining({ RoofType: 'Peak30NS', width: 4, height: 3, Depth: 'Zero' }));
        h.point(5.75, 4.75); h.tool.beginDrag(5, 4); h.point(7.75, 6.75); h.tool.endDrag(7, 6);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ width: 6, height: 5, Depth: 'Zero' }));
        expect(h.tool.statusText).toBe('');
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before); h.store.dispatch(new Redo());
        const saved = readBuildingFile(writeBuildingFile(h.buildings.building));
        expect(saved.floors[0].objects[0]).toEqual(jasmine.objectContaining({ RoofType: 'Peak30NS', Depth: 'Zero', cappedN: 'true', cappedW: 'false' }));
        expect(Number(saved.floors[0].objects[0].width)).toBe(6);
        const reopened = saved.floors[0].objects[0];
        expect(resizeNativeRoof(reopened, Number(reopened.width), Number(reopened.height), false).width).toBe(6);
        h.destroy();
    });
    it('shows green only for the idle cursor and shaded gray faces while creating a roof', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('slope-w'); h.point(3.2, 4.2);
        expect(h.tool.dragTiles).toEqual([]);
        expect(h.tool.overlays[0].points).toEqual([{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
        const before = h.buildings.building;
        h.tool.beginDrag(3, 4); h.point(4.2, 6.2);
        expect(h.tool.statusText).toContain('Width,Height = 2,3');
        expect(h.tool.overlays.some(o => o.fill === '#00ff0080')).toBeFalse();
        expect(h.tool.overlays[0].fill).toBe('#80808040');
        expect(h.tool.overlays[h.tool.overlays.length - 1].stroke).toBe('#0000ff40');
        expect(h.tool.previewTiles).toBeDefined();
        expect(h.buildings.building).toBe(before);
        h.tool.endDrag(4, 6);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ x: 3, y: 4, width: 2, height: 3, RoofType: 'SlopeW', Depth: 'OnePoint5' }));
        expect(h.state.value.past.length).toBe(1); h.destroy();
    });

    it('keeps the resize preview gray and restores the green cursor after cancellation', () => {
        const h = setup(); h.add('PeakNS'); h.point(5.75, 5.75);
        h.tool.beginDrag(5, 5); h.point(6.75, 7.75);
        expect(h.tool.overlays.some(o => o.fill === '#00ff0080')).toBeFalse();
        expect(h.tool.overlays.some(o => o.fill === '#80808040')).toBeTrue();
        expect(h.tool.overlays.some(o => o.fill === '#c0c0c040')).toBeTrue();
        h.tool.cancel(); h.point(10.2, 10.2);
        expect(h.tool.overlays[0].fill).toBe('#00ff0080'); h.destroy();
    });

    it('anchors restricted slopes to the starting cell when dragging backwards', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('slope-w');
        h.point(8.8, 7.8); h.tool.beginDrag(8, 7); h.point(2.2, 3.2); h.tool.endDrag(2, 3);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ x: 6, y: 3, width: 3, height: 5 }));
        h.destroy();
    });

    it('creates full depth on a single click and changes half depth during same-cell mouse movement', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('slope-w'); h.click(2.2, 2.2);
        expect(h.buildings.building.floors[0].objects[0].Depth).toBe('One');
        h.point(7.2, 7.2); h.tool.beginDrag(7, 7); h.point(7.3, 7.2); h.tool.endDrag(7, 7);
        expect(h.buildings.building.floors[0].objects[1].Depth).toBe('Point5'); h.destroy();
    });

    it('resizes by UID in one command and preserves caps, materials, and position through save/reopen', () => {
        const h = setup(), roof = h.add('PeakNS');
        const before = h.buildings.building, commands = h.state.value.past.length;
        h.point(5.75, 5.75); expect(h.tool.cursor).toBe('move');
        h.tool.beginDrag(5, 5); h.point(6.8, 7.8);
        expect(h.buildings.building).toBe(before);
        h.tool.endDrag(6, 7);
        expect(h.state.value.past.length).toBe(commands + 1);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ uid: roof.uid, x: 2, y: 2, width: 5, height: 6, Depth: 'TwoPoint5', CapTiles: roof.CapTiles, cappedN: true }));
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
        h.store.dispatch(new Redo());
        const saved = readBuildingFile(writeBuildingFile(h.buildings.building));
        expect(Number(saved.floors[0].objects[0].width)).toBe(5);
        expect(Number(saved.floors[0].objects[0].height)).toBe(6);
        expect(saved.floors[0].objects[0].Depth).toBe('TwoPoint5'); h.destroy();
    });

    it('toggles caps off and back on while keeping the disabled handle visible and crossed', () => {
        const h = setup(), roof = h.add('PeakNS');
        h.click(3.5, 2.2);
        expect(h.buildings.building.floors[0].objects[0].cappedN).toBeFalse();
        expect(h.tool.overlays.some(o => o.crossed)).toBeTrue();
        h.click(3.5, 2.2);
        expect(h.buildings.building.floors[0].objects[0].cappedN).toBeTrue();
        expect(h.buildings.building.floors[0].objects[0].uid).toBe(roof.uid);
        expect(h.buildings.building.floors[0].objects.length).toBe(1);
        h.store.dispatch(new Undo()); expect(h.buildings.building.floors[0].objects[0].cappedN).toBeFalse(); h.destroy();
    });

    it('changes slope half-depth during resizing within the same cell without changing its footprint', () => {
        const h = setup(), roof = h.add('SlopeW', 2, 3);
        h.point(3.75, 4.75); h.tool.beginDrag(3, 4); h.point(3.2, 4.75); h.tool.endDrag(3, 4);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ uid: roof.uid, width: 2, height: 3, Depth: 'OnePoint5' }));
        h.store.dispatch(new Undo()); expect(h.buildings.building.floors[0].objects[0].Depth).toBe('Two'); h.destroy();
    });

    it('uses flat-roof depth buttons with limit indicators and no extra history at a limit', () => {
        const h = setup(); h.add(); const commands = h.state.value.past.length;
        h.click(4, 4.2); expect(h.state.value.past.length).toBe(commands);
        for (const depth of ['One', 'Two', 'Three']) {
            h.click(4, 3.8); expect(h.buildings.building.floors[0].objects[0].Depth).toBe(depth);
        }
        h.click(4, 3.8); expect(h.state.value.past.length).toBe(commands + 3);
        expect(h.tool.overlays.some(o => o.label === '+' && o.crossed)).toBeTrue();
        h.click(4, 4.2); expect(h.buildings.building.floors[0].objects[0].Depth).toBe('Two'); h.destroy();
    });

    it('previews a shrinking roof without leaving old generated tiles behind, and cancellation restores it', () => {
        const h = setup(); h.add('FlatTop', 6, 6); h.store.dispatch(new AddTile(10, 10, 0, 'Floor', 'manual.png'));
        const before = h.buildings.building;
        h.point(7.75, 7.75); h.tool.beginDrag(7, 7); h.point(4.75, 4.75);
        h.grid.redrawTiles(h.tool.previewTiles);
        expect(h.grid.tiles.some(t => t.x === 7 && t.y === 7 && t.name === 'West3.png')).toBeFalse();
        expect(h.grid.tiles.some(t => t.name === 'manual.png')).toBeTrue();
        expect(h.buildings.building).toBe(before);
        h.tool.cancel(); h.tool.endDrag(4, 4); h.grid.redrawTiles();
        expect(h.grid.tiles.some(t => t.x === 7 && t.y === 7 && t.name === 'West3.png')).toBeTrue();
        expect(h.buildings.building).toBe(before); h.destroy();
    });

    it('cancels creation and floor-changing resizes without edits', () => {
        const h = setup(), before = h.buildings.building;
        h.tool.beginDrag(1, 1); h.tool.hoverTile(4, 4); h.tool.cancel(); h.tool.endDrag(4, 4);
        expect(h.buildings.building).toBe(before);
        h.add(); const roof = h.buildings.building;
        h.point(5.8, 5.8); h.tool.beginDrag(5, 5); h.point(7.8, 7.8); h.grid.setSelectedLevel(1); h.tool.endDrag(7, 7);
        expect(h.buildings.building).toBe(roof); h.destroy();
    });

    it('edits only the selected floor when roofs overlap', () => {
        const h = setup(); h.add('PeakNS', 4, 4, 0); h.add('PeakNS', 4, 4, 1); h.grid.setSelectedLevel(1);
        h.click(3.5, 2.2);
        expect(h.buildings.building.floors[0].objects[0].cappedN).toBeTrue();
        expect(h.buildings.building.floors[1].objects[0].cappedN).toBeFalse(); h.destroy();
    });
});

describe('Native roof handle and fractional rules', () => {
    it('joins the native half-depth faces at the center of an odd-width peak', () => {
        const overlays = nativeRoofPreview({ x: 2, y: 3, width: 5, height: 4, RoofType: 'PeakNS', Depth: 'TwoPoint5' }, true);
        expect(overlays.slice(0, -1).map(o => ({ left: o.points[0].x, right: o.points[1].x, fill: o.fill }))).toEqual([
            { left: 2, right: 4.5, fill: '#80808040' },
            { left: 4.5, right: 7, fill: '#c0c0c040' }
        ]);
    });

    it('draws flat tops gray and uses red feedback only for invalid placement', () => {
        const roof = { x: 1, y: 2, width: 4, height: 3, RoofType: 'FlatTop', Depth: 'One' };
        expect(nativeRoofPreview(roof, true).map(o => o.fill)).toEqual(['#a0a0a440', 'transparent']);
        expect(nativeRoofPreview(roof, false)[1]).toEqual(jasmine.objectContaining({ fill: '#ff000020', stroke: '#ff000040' }));
    });

    it('uses half-tile resize handles and native type-specific cap visibility', () => {
        const roof = { x: 2, y: 3, width: 4, height: 5, Depth: 'One' };
        const peak = nativeRoofHandles({ ...roof, RoofType: 'PeakNS', cappedN: false });
        expect(peak.map(h => h.kind)).toEqual(['resize', 'cappedN', 'cappedS']);
        expect(peak[0].bounds).toEqual({ x: 5.5, y: 7.5, width: 0.5, height: 0.5 });
        expect(peak[1].crossed).toBeTrue();
        expect(nativeRoofHandles({ ...roof, RoofType: 'CornerInnerNW' }).map(h => h.kind)).toEqual(['resize', 'cappedW', 'cappedN', 'cappedE', 'cappedS']);
        expect(nativeRoofHandles({ ...roof, RoofType: 'CornerOuterNW' }).map(h => h.kind)).toEqual(['resize', 'cappedE', 'cappedS']);
    });

    it('chooses half depths from the mouse half-cell and reverses the rule for east/south slopes', () => {
        const o = { x: 1, y: 1, width: 2, height: 2 };
        expect(nativeRoofHalfDepth({ ...o, RoofType: 'SlopeW' }, 2, 2, { x: 2.2, y: 2.8 }, true)).toBeTrue();
        expect(nativeRoofHalfDepth({ ...o, RoofType: 'SlopeE' }, 2, 2, { x: 2.2, y: 2.8 }, true)).toBeFalse();
        expect(nativeRoofHalfDepth({ ...o, RoofType: 'SlopeN' }, 2, 2, { x: 2.8, y: 2.2 }, true)).toBeTrue();
        expect(nativeRoofHalfDepth({ ...o, RoofType: 'SlopeS' }, 2, 2, { x: 2.8, y: 2.2 }, true)).toBeFalse();
        expect(nativeRoofHalfDepth({ ...o, RoofType: 'CornerInnerNW' }, 2, 2, { x: 2.2, y: 2.8 }, true)).toBeFalse();
        expect(nativeRoofHalfDepth({ ...o, RoofType: 'CornerInnerNW' }, 2, 2, { x: 2.2, y: 2.8 }, true, -1, 0)).toBeTrue();
    });
});
