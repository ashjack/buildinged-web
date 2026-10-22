import { Store } from '@ngrx/store';
import * as fromRoot from '../app.reducers';
import { AddObject } from '../app.actions';
import { BuildingService } from '../services/building.service';
import { GridService } from '../services/grid.service';
import { generateBuildingSquares } from '../services/native-squares';
import { ToolSettingsService } from '../services/tool-settings.service';
import { validObject } from '../utils/selection-edits';
import { rectanglePoints } from '../utils/native-pointer';
import ToolDraw from './tool-draw';

export default class ToolStairs extends ToolDraw {
    private edge = '';
    constructor(private buildings: BuildingService, private grid: GridService,
        private store: Store<fromRoot.State>, private settings = new ToolSettingsService()) { super(); }
    private object(x: number, y: number) {
        return { uid: 'stairs-preview', type: 'stairs', x, y, dir: this.edge === 'E' || this.edge === 'N' ? 'W' : 'N',
            Tile: this.settings.stairs ?? this.buildings.building.Stairs };
    }
    override hoverTile(x: number, y: number, edge?: string): void {
        // BaseObjectTool freezes the cursor object while a mouse button is held.
        if (this.isDragging) return;
        this.edge = edge || ''; this.tileGhosts = []; this.dragTiles = []; this.overlays = [];
        const b = this.buildings.building, level = this.grid.getSelectedLevel();
        if (!b || !this.edge || this.modifiers.alt || x < 0 || y < 0 || x >= b.width || y >= b.height) return;
        const o = this.object(x, y), vertical = o.dir === 'N', valid = validObject(b, o);
        this.overlays = [{ points: rectanglePoints({ x, y, width: vertical ? 1 : 5, height: vertical ? 5 : 1 }),
            fill: valid ? '#00ff0080' : '#ff000080', stroke: '#000' }];
        this.settings.message = valid ? '' : 'Stairs need a five-square footprint inside the building.';
        if (!valid) return;
        this.tileGhosts = generateBuildingSquares({ ...b, floors: b.floors.map((f, i) => i === level ? { ...f, objects: [...f.objects, o] } : f) })
            .tiles.filter(t => t.object === o.uid && t.level === level);
    }
    override beginDrag(x: number, y: number): void {
        if (this.isDragging) return;
        const b = this.buildings.building, level = this.grid.getSelectedLevel();
        if (!b) return;
        if (this.modifiers.alt) {
            const o = b.floors[level].objects.find(o => o.uid === this.hoveredObject?.uid && o.type === 'stairs');
            if (o) this.settings.stairs = Number(o.Tile);
            this.cancel(); return;
        }
        const edge = this.edge, o = this.object(x, y);
        // StairsTool uses BaseObjectTool's default placement on press, not release.
        if (edge && x >= 0 && y >= 0 && x < b.width && y < b.height && validObject(b, o)) {
            const { uid, ...object } = o; this.store.dispatch(new AddObject(object, level));
        }
        this.hoverTile(x, y, edge);
        const ghosts = this.tileGhosts, overlays = this.overlays;
        this.startGesture(x, y, level); this.tileGhosts = ghosts; this.overlays = overlays;
    }
    override endDrag(x: number, y: number): void {
        const edge = this.edge, start = this.finishGesture(this.grid.getSelectedLevel());
        if (start) this.hoverTile(start.x, start.y, edge);
    }
    override clickTile(x: number, y: number): void { this.beginDrag(x, y); this.endDrag(x, y); }
    override getTileFill(): string { return '#00000000'; }
}
