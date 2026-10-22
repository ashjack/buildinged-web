import { AddObject, AddTile, Redo, Undo } from '../app.actions';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { documentHarness } from '../testing/document-harness';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { emptyIndexGrid, writeIndexGrid } from '../utils/tbx-grid';
import { nativeRoofHalfDepth, nativeRoofHandles, resizeNativeRoof } from '../utils/native-roof';
import { RoofService } from '../services/roof.service';
import ToolRoof from './tool-roof';

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
    it('shows the native full-cell cursor, then a normalized footprint with half-depth controlled within the cell', () => {
        const h = setup(); h.roofs.setSelectedRoofOptionId('slope-w'); h.point(3.2, 4.2);
        expect(h.tool.dragTiles).toEqual([]);
        expect(h.tool.overlays[0].points).toEqual([{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
        const before = h.buildings.building;
        h.tool.beginDrag(3, 4); h.point(4.2, 6.2);
        expect(h.buildings.building).toBe(before);
        h.tool.endDrag(4, 6);
        expect(h.buildings.building.floors[0].objects[0]).toEqual(jasmine.objectContaining({ x: 3, y: 4, width: 2, height: 3, RoofType: 'SlopeW', Depth: 'OnePoint5' }));
        expect(h.state.value.past.length).toBe(1); h.destroy();
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
