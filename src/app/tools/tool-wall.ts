import { Store } from '@ngrx/store';
import * as fromRoot from '../app.reducers';
import { AddObject, UpdateObject } from '../app.actions';
import { BuildingService } from '../services/building.service';
import { GridService } from '../services/grid.service';
import { generateBuildingSquares } from '../services/native-squares';
import { ToolSettingsService } from '../services/tool-settings.service';
import { validObject } from '../utils/selection-edits';
import { insideRectangle, nativeWallHandles, nativeWallShape, rectanglePoints } from '../utils/native-pointer';
import { GUID } from '../utils/guid';
import ToolDraw from './tool-draw';
import { resolveObjectMaterials } from '../utils/object-materials';

export default class ToolWall extends ToolDraw {
    private corner = '';
    private resizing: any;
    private resizeStart = false;
    private lastCandidate: any;
    constructor(private buildings: BuildingService, private grid: GridService,
        private store: Store<fromRoot.State>, private settings = new ToolSettingsService()) { super(); }
    override cancel(): void {
        super.cancel(); this.resizing = undefined; this.lastCandidate = undefined; this.cursor = 'default';
    }
    private point(x: number, y: number) {
        if (this.pointerPosition) return { x: Math.floor(this.pointerPosition.x) + (this.pointerPosition.x % 1 > 0.5 ? 1 : 0),
            y: Math.floor(this.pointerPosition.y) + (this.pointerPosition.y % 1 >= 0.5 ? 1 : 0) };
        return { x: x + (['NE', 'SE'].includes(this.corner) ? 1 : 0), y: y + (['SW', 'SE'].includes(this.corner) ? 1 : 0) };
    }
    private wallUnderPointer(x: number, y: number): any {
        const p = this.pointerPosition || this.point(x, y);
        return [...(this.buildings.building?.floors[this.grid.getSelectedLevel()]?.objects || [])].reverse()
            .find(o => o.type === 'wall' && insideRectangle(nativeWallShape(o), p));
    }
    private candidate(x: number, y: number): any {
        const b = this.buildings.building;
        if (this.resizing) {
            const o = this.resizing, vertical = o.dir === 'N', axis = vertical ? Number(o.y) : Number(o.x);
            const coordinate = vertical ? y : x, end = axis + Number(o.length), limit = vertical ? b.height : b.width;
            const start = this.resizeStart ? Math.max(0, Math.min(end - 1, coordinate)) : axis;
            const finish = this.resizeStart ? end : Math.max(axis + 1, Math.min(limit, coordinate));
            return { ...o, x: vertical ? Number(o.x) : start, y: vertical ? start : Number(o.y), length: finish - start };
        }
        const start = { x: this.beginDragCoords[0], y: this.beginDragCoords[1] };
        const vertical = Math.abs(y - start.y) > Math.abs(x - start.x);
        return { uid: 'wall-preview', type: 'wall', x: vertical ? start.x : Math.min(start.x, x),
            y: vertical ? Math.min(start.y, y) : start.y, dir: vertical ? 'N' : 'W',
            length: Math.max(1, Math.abs(vertical ? y - start.y : x - start.x)),
            Tile: this.settings.exterior ?? b.ExteriorWall, InteriorTile: this.settings.interior ?? b.rooms[0]?.InteriorWall ?? 0,
            ExteriorTrim: this.settings.exteriorTrim ?? b.ExteriorWallTrim,
            InteriorTrim: this.settings.interiorTrim ?? b.rooms[0]?.InteriorWallTrim ?? 0 };
    }
    private overlay(rect: { x: number; y: number; width: number; height: number }, fill: string): void {
        this.overlays.push({ points: rectanglePoints(rect), fill, stroke: '#000' });
    }
    override beginDrag(x: number, y: number): void {
        const b = this.buildings.building; if (!b || this.isDragging) return;
        const point = this.point(x, y), wall = this.wallUnderPointer(x, y), p = this.pointerPosition || point;
        if (this.modifiers.alt) {
            if (wall) { this.settings.wallMaterials = {}; this.settings.exterior = Number(wall.Tile); this.settings.interior = Number(wall.InteriorTile);
                this.settings.exteriorTrim = Number(wall.ExteriorTrim); this.settings.interiorTrim = Number(wall.InteriorTrim); }
            this.cancel(); return;
        }
        if (point.x < 0 || point.y < 0 || point.x > b.width || point.y > b.height) return;
        const handle = wall ? nativeWallHandles(wall).findIndex(r => insideRectangle(r, p)) : -1;
        this.startGesture(point.x, point.y, this.grid.getSelectedLevel());
        if (handle >= 0) { this.resizing = wall; this.resizeStart = handle === 0; }
        this.hoverTile(x, y, undefined, this.corner);
    }
    override hoverTile(x: number, y: number, edge?: string, corner?: string): void {
        this.corner = corner || ''; const point = this.point(x, y);
        this.dragTiles = []; this.tileGhosts = []; this.overlays = []; this.cursor = 'crosshair';
        const b = this.buildings.building; if (!b) return;
        if (!this.isDragging) {
            const wall = this.wallUnderPointer(x, y), p = this.pointerPosition || point;
            let handle = -1;
            if (wall && !this.modifiers.alt) {
                const handles = nativeWallHandles(wall); handle = handles.findIndex(r => insideRectangle(r, p));
                handles.forEach((r, i) => this.overlay(r, handle === i ? '#fff' : '#808080'));
            }
            if (handle >= 0) this.cursor = 'move';
            else if (!this.modifiers.alt && point.x >= 0 && point.y >= 0 && point.x <= b.width && point.y <= b.height)
                this.overlay({ x: point.x - 0.2, y: point.y - 0.2, width: 0.4, height: 0.4 }, '#00ff0080');
            return;
        }
        const outside = point.x < 0 || point.y < 0 || point.x > b.width || point.y > b.height;
        const candidate = outside && !this.resizing && this.lastCandidate ? this.lastCandidate : this.candidate(point.x, point.y);
        this.lastCandidate = candidate;
        const valid = validObject(b, candidate);
        this.overlay(nativeWallShape(candidate), valid ? '#00ff0080' : '#ff000080');
        if (this.resizing) nativeWallHandles(candidate).forEach(r => this.overlay(r, '#fff'));
        this.settings.message = valid ? '' : 'Wall must fit inside the building.';
        if (!valid) return;
        const level = this.grid.getSelectedLevel();
        const resolved = resolveObjectMaterials(b, candidate, this.resizing ? {} : this.settings.wallMaterials);
        this.tileGhosts = generateBuildingSquares({ ...resolved.building, floors: b.floors.map((f, i) => i === level ? { ...f,
            objects: [...f.objects.filter(o => o.uid !== candidate.uid), resolved.object] } : f) }).tiles.filter(t => t.object === candidate.uid && t.level === level);
    }
    override endDrag(x: number, y: number): void {
        if (!this.isDragging) return;
        this.hoverTile(x, y, undefined, this.corner);
        const candidate = this.lastCandidate, resizing = this.resizing;
        const start = this.finishGesture(this.grid.getSelectedLevel());
        if (!start || !candidate || !validObject(this.buildings.building, candidate)) return;
        if (resizing) this.store.dispatch(new UpdateObject(resizing.uid, { x: candidate.x, y: candidate.y, length: candidate.length }));
        else this.store.dispatch(new AddObject({ ...candidate, uid: GUID.generateGUID() }, start.level, undefined, this.settings.wallMaterials));
    }
    override clickTile(x: number, y: number): void { this.beginDrag(x, y); this.endDrag(x, y); }
    override getTileFill(): string { return '#00000000'; }
}
