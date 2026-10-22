import { Point } from '../models/app.models';
import { GridService } from '../services/grid.service';
import { RoofService } from '../services/roof.service';
import { insideRectangle, rectanglePoints } from '../utils/native-pointer';
import { nativeRoofHalfDepth, nativeRoofHandles, resizeNativeRoof, roofRect, RoofHandle } from '../utils/native-roof';
import { validObject } from '../utils/selection-edits';
import ToolDraw from './tool-draw';

export default class ToolRoof extends ToolDraw {
    private candidate: any;
    private original: any;
    private resizeStart = { x: 0, y: 0 };
    private handleRoof: any;
    private handle: RoofHandle | undefined;
    private lastCell: Point | undefined;
    private lastPointer: Point | undefined;
    get resizingUid(): string | undefined { return this.original?.uid; }
    constructor(private roofService: RoofService, private grid: GridService) { super(); }
    override cancel(): void {
        super.cancel(); this.candidate = this.original = this.handleRoof = undefined;
        this.handle = undefined; this.lastCell = this.lastPointer = undefined; this.cursor = 'default';
        this.roofService.message = '';
    }
    private point(x: number, y: number): Point { return this.pointerPosition || { x: x + 0.5, y: y + 0.5 }; }
    private addRect(bounds: { x: number; y: number; width: number; height: number }, fill: string): void {
        this.overlays.push({ points: rectanglePoints(bounds), fill, stroke: '#000' });
    }
    private handles(o: any, p: Point): RoofHandle | undefined {
        const handles = nativeRoofHandles(o);
        this.handle = [...handles].reverse().find(h => insideRectangle(h.bounds, p));
        for (const h of handles) this.overlays.push({ points: rectanglePoints(h.bounds), fill: this.handle === h ? '#fff' : '#808080',
            stroke: '#000', crossed: h.crossed, label: h.kind === 'depthUp' ? '+' : h.kind === 'depthDown' ? '-' : undefined });
        return this.handle;
    }
    override beginDrag(x: number, y: number): void {
        if (this.isDragging) return;
        const b = this.roofService.building; if (!b) return;
        this.hoverTile(x, y);
        const o = this.handleRoof, h = this.handle;
        if (o && h && h.kind !== 'resize') {
            this.cancel();
            if (h.kind.startsWith('capped')) {
                const capped = o[h.kind] !== false && o[h.kind] !== 'false';
                this.roofService.update(o.uid, { [h.kind]: !capped });
            } else {
                const depths = ['Zero', 'One', 'Two', 'Three'], index = depths.indexOf(o.Depth);
                const next = index + (h.kind === 'depthUp' ? 1 : -1);
                if (index >= 0 && next >= 0 && next < depths.length) this.roofService.update(o.uid, { Depth: depths[next] });
            }
            this.hoverTile(x, y); return;
        }
        if (!h && (x < 0 || y < 0 || x >= b.width || y >= b.height)) return;
        this.startGesture(x, y, this.grid.getSelectedLevel());
        if (o && h?.kind === 'resize') {
            this.original = o; this.candidate = { ...o }; this.resizeStart = { x, y };
        } else this.candidate = this.roofService.createObject(x, y, this.roofService.getSelectedRoofType());
        this.lastCell = { x, y }; this.lastPointer = this.point(x, y);
        this.drawCandidate();
    }
    override hoverTile(x: number, y: number): void {
        this.dragTiles = []; this.tileGhosts = []; this.overlays = []; this.cursor = 'crosshair';
        const b = this.roofService.building; if (!b) return;
        const p = this.point(x, y), level = this.grid.getSelectedLevel();
        if (!this.isDragging) {
            this.previewTiles = undefined;
            this.handleRoof = [...b.floors[level].objects].reverse().find(o => o.type === 'roof' && insideRectangle(roofRect(o), p));
            this.handle = undefined;
            if (this.handleRoof) this.handle = this.handles(this.handleRoof, p);
            if (!this.handle && x >= 0 && y >= 0 && x < b.width && y < b.height) this.addRect({ x, y, width: 1, height: 1 }, '#00ff0080');
            if (this.handle) this.cursor = this.handle.kind === 'resize' ? 'move' : 'pointer';
            this.roofService.message = this.handle ? this.handle.kind === 'resize' ? 'Drag to resize the roof. Right-click to cancel.'
                : this.handle.kind.startsWith('capped') ? 'Click to toggle the roof cap.' : 'Click to change flat-roof depth.' : '';
            return;
        }
        if (!this.candidate) return;
        if (this.original) {
            const previous = this.candidate, r = roofRect(previous);
            let dx = x - this.resizeStart.x, dy = y - this.resizeStart.y;
            if (x < r.x) dx = r.x - this.resizeStart.x;
            if (y < r.y) dy = r.y - this.resizeStart.y;
            if (x >= b.width) dx = b.width - this.resizeStart.x - 1;
            if (y >= b.height) dy = b.height - this.resizeStart.y - 1;
            const width = r.width + dx, height = r.height + dy;
            if (width >= 1 && height >= 1) {
                const half = nativeRoofHalfDepth(previous, width, height, p, false);
                const next = resizeNativeRoof(previous, width, height, half);
                if (validObject(b, next)) { this.candidate = next; this.resizeStart = { x: Number(next.x) + next.width - 1, y: Number(next.y) + next.height - 1 }; }
            }
        } else if (x >= 0 && y >= 0 && x < b.width && y < b.height) {
            const dx = x - this.beginDragCoords[0], dy = y - this.beginDragCoords[1];
            const half = nativeRoofHalfDepth(this.candidate, Math.abs(dx) + 1, Math.abs(dy) + 1, p, true, dx, dy);
            this.candidate = resizeNativeRoof(this.candidate, Math.abs(dx) + 1, Math.abs(dy) + 1, half);
            this.candidate.x = this.beginDragCoords[0] - (dx < 0 ? this.candidate.width - 1 : 0);
            this.candidate.y = this.beginDragCoords[1] - (dy < 0 ? this.candidate.height - 1 : 0);
        }
        this.lastCell = { x, y }; this.lastPointer = { ...p };
        this.drawCandidate();
    }
    private drawCandidate(): void {
        this.overlays = []; this.tileGhosts = []; this.dragTiles = [];
        const b = this.roofService.building, valid = validObject(b, this.candidate);
        this.addRect(roofRect(this.candidate), valid ? '#00ff0080' : '#ff000080');
        if (this.original) this.handles(this.candidate, this.lastPointer || { x: -1, y: -1 });
        this.previewTiles = valid ? this.roofService.preview(this.candidate, this.grid.getSelectedLevel()) : undefined;
        this.roofService.message = `Width, height: ${this.candidate.width}, ${this.candidate.height}. Right-click to cancel.`;
    }
    override endDrag(x: number, y: number): void {
        if (!this.isDragging) return;
        const p = this.point(x, y);
        if (this.lastCell?.x !== x || this.lastCell?.y !== y || this.lastPointer?.x !== p.x || this.lastPointer?.y !== p.y) this.hoverTile(x, y);
        const candidate = this.candidate, resizing = !!this.original;
        const start = this.finishGesture(this.grid.getSelectedLevel());
        if (start && candidate) this.roofService.commit(candidate, start.level, resizing);
    }
    override clickTile(x: number, y: number): void { this.beginDrag(x, y); this.endDrag(x, y); }
    override getTileFill(): string { return '#00000000'; }
}
