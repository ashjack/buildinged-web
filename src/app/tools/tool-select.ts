import { Store } from '@ngrx/store';
import { take } from 'rxjs';
import * as fromRoot from '../app.reducers';
import { TransformSelection } from '../app.actions';
import { Building, TileArea } from '../models/app.models';
import { BuildingService } from '../services/building.service';
import { GridService } from '../services/grid.service';
import { ToolSettingsService } from '../services/tool-settings.service';
import { contains, objectBounds, SelectionEdit, validObject } from '../utils/selection-edits';
import { tileAreaBetween } from '../utils/tool-placement';
import ToolDraw from './tool-draw';

export default class ToolSelect extends ToolDraw {
    area: TileArea | undefined;
    uids: string[] = [];
    private moving = false;
    private hit: string | undefined;
    private level = -1;
    private layer = '';
    constructor(public mode: SelectionEdit['mode'], private grid: GridService,
        private buildings: BuildingService, private store: Store<fromRoot.State>, private settings = new ToolSettingsService()) { super(); }

    override reset(): void { this.cancel(); this.area = undefined; this.uids = []; this.level = -1; }
    private sync(): void {
        if (this.level !== this.grid.getSelectedLevel() || this.mode === 'tiles' && this.layer !== this.selectedLayer()) this.reset();
        this.level = this.grid.getSelectedLevel(); this.layer = this.selectedLayer();
        const ids = new Set(this.buildings.building?.floors[this.level]?.objects.map(o => o.uid));
        this.uids = this.uids.filter(uid => ids.has(uid));
    }
    private selectedLayer(): string { return localStorage.getItem('selectedLayer') || 'Walls'; }
    private hitAt(x: number, y: number): string | undefined {
        if (this.hoveredObject?.level === this.level) return this.hoveredObject.uid;
        const b = this.buildings.building;
        return [...(b?.floors[this.level]?.objects || [])].reverse().find(o => contains(objectBounds(b, o), x, y))?.uid;
    }
    override beginDrag(x: number, y: number): void {
        this.sync(); this.startGesture(x, y, this.level);
        this.hit = this.mode === 'objects' ? this.hitAt(x, y) : undefined;
        this.moving = this.mode === 'objects' ? !!this.hit && !this.modifiers.ctrl && !this.modifiers.shift
            : !!this.area && contains(this.area, x, y);
        if (this.moving && this.hit && !this.uids.includes(this.hit)) this.uids = [this.hit];
        this.hoverTile(x, y);
    }
    override hoverTile(x: number, y: number): void {
        this.sync();
        const start = this.beginDragCoords;
        const area = this.isDragging && !this.moving ? this.clip(tileAreaBetween(start[0], start[1], x, y)) : this.area;
        const dx = this.isDragging && this.moving ? x - start[0] : 0, dy = this.isDragging && this.moving ? y - start[1] : 0;
        this.dragTiles = []; this.tileGhosts = [];
        if (this.mode === 'objects' && (!this.isDragging || this.moving)) {
            this.buildings.building?.floors[this.level]?.objects.filter(o => this.uids.includes(o.uid)).forEach(o => {
                const r = objectBounds(this.buildings.building, o); this.mark({ ...r, x: r.x + dx, y: r.y + dy });
            });
            if (this.isDragging && this.moving) this.tileGhosts = this.grid.roomTiles.filter(t => typeof t.object === 'string' && this.uids.includes(t.object) && t.level === this.level)
                .map(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
        } else if (area) {
            this.mark({ ...area, x: area.x + dx, y: area.y + dy });
            if (this.isDragging && this.moving) {
                const tiles = this.mode === 'tiles' ? this.grid.userTiles.filter(t => t.layer === this.layer)
                    : this.grid.roomTiles.filter(t => t.layer === 'Floor');
                this.tileGhosts = tiles.filter(t => t.level === this.level && contains(area, t.x, t.y))
                    .map(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
            }
        }
    }
    private mark(area: TileArea): void {
        for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++)
            this.dragTiles.push({ x, y, level: this.level, layer: '', url: '' });
    }
    private clip(area: TileArea): TileArea | undefined {
        const b = this.buildings.building; if (!b) return undefined;
        const border = this.mode === 'tiles' ? 1 : 0;
        const x = Math.max(0, area.x), y = Math.max(0, area.y);
        const width = Math.min(b.width + border, area.x + area.width) - x, height = Math.min(b.height + border, area.y + area.height) - y;
        return width > 0 && height > 0 ? { x, y, width, height } : undefined;
    }
    override endDrag(x: number, y: number): void {
        const moving = this.moving, hit = this.hit;
        const start = this.finishGesture(this.grid.getSelectedLevel()); if (!start) return;
        if (moving) this.move(x - start.x, y - start.y);
        else if (this.mode === 'objects') {
            const b = this.buildings.building, area = tileAreaBetween(start.x, start.y, x, y);
            const ids = x === start.x && y === start.y ? hit ? [hit] : [] : b.floors[start.level].objects.filter(o => {
                const r = objectBounds(b, o);
                return r.x < area.x + area.width && r.x + r.width > area.x && r.y < area.y + area.height && r.y + r.height > area.y;
            }).map(o => o.uid);
            this.uids = this.modifiers.shift ? [...new Set([...this.uids, ...ids])]
                : this.modifiers.ctrl ? this.uids.filter(id => !ids.includes(id)) : ids;
        } else this.area = this.clip(tileAreaBetween(start.x, start.y, x, y));
        this.hoverTile(x, y);
    }
    private edit(dx: number, dy: number, erase = false): void {
        const before = this.buildings.building;
        this.store.dispatch(new TransformSelection({ mode: this.mode, area: this.area, uids: [...this.uids], level: this.level,
            dx, dy, erase, layer: this.layer, allFloors: this.mode === 'rooms' && this.modifiers.ctrl,
            includeObjects: this.mode === 'rooms' && this.modifiers.shift }));
        let after: Building | undefined;
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(b => after = b);
        if (after !== before) {
            this.settings.message = '';
            if (erase) { this.area = undefined; this.uids = []; }
            else if (this.area) this.area = { ...this.area, x: this.area.x + dx, y: this.area.y + dy };
        } else if (dx || dy) {
            const r = this.area, border = this.mode === 'tiles' ? 1 : 0;
            const validArea = !r || r.x + dx >= 0 && r.y + dy >= 0 && r.x + r.width + dx <= before.width + border && r.y + r.height + dy <= before.height + border;
            const validObjects = before.floors.every((f, i) => i !== this.level && !(this.mode === 'rooms' && this.modifiers.ctrl) || f.objects.every(o => {
                const selected = this.mode === 'objects' ? this.uids.includes(o.uid) : this.mode === 'rooms' && this.modifiers.shift && r && contains(r, Number(o.x), Number(o.y));
                return !selected || validObject(before, { ...o, x: Number(o.x) + dx, y: Number(o.y) + dy });
            }));
            if (validArea && validObjects) {
                if (r) this.area = { ...r, x: r.x + dx, y: r.y + dy };
                this.settings.message = '';
            } else this.settings.message = 'Move rejected: keep the entire selection inside the building.';
        }
    }
    move(dx: number, dy: number): void { this.sync(); if (this.area || this.uids.length) this.edit(dx, dy); }
    override deleteSelection(): boolean {
        this.sync(); if (!this.area && !this.uids.length) return false;
        this.edit(0, 0, true); return true;
    }
    override keyDown(key: string): boolean {
        const delta: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (!delta[key] || !this.area && !this.uids.length) return false;
        this.move(delta[key][0], delta[key][1]); this.hoverTile(0, 0); return true;
    }
    override clickTile(x: number, y: number): void { this.beginDrag(x, y); this.endDrag(x, y); }
    override getTileFill(x: number, y: number): string {
        return this.dragTiles.some(t => t.x === x && t.y === y) ? '#328ce080' : '#00000000';
    }
}
