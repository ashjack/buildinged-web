import { Store } from '@ngrx/store';
import { take } from 'rxjs';
import * as fromRoot from '../app.reducers';
import { EditTiles, PaintTileCells } from '../app.actions';
import { SvgTile } from '../models/app.models';
import { GridService } from '../services/grid.service';
import { TileEditMode, ToolSettingsService } from '../services/tool-settings.service';
import { TileCellEdit } from '../utils/selection-edits';
import { gridContains } from '../utils/tbx-grid';
import { tileAreaBetween } from '../utils/tool-placement';
import ToolDraw from './tool-draw';

export default class ToolTile extends ToolDraw {
    selectedTile = 'walls_exterior_house_01_004.png';
    selectedLayer = 'Walls';
    selectedLevel = 0;
    capturing = false;
    private mode: TileEditMode = 'rectangle';
    private erasing = false;
    private cells = new Map<string, TileCellEdit>();
    private last: { x: number; y: number } | undefined;
    constructor(private gridService: GridService, private store: Store<fromRoot.State>,
        private settings = new ToolSettingsService()) { super(); }

    override cancel(): void { super.cancel(); this.cells.clear(); this.last = undefined; this.capturing = false; }
    private readPalette(): void {
        this.selectedTile = localStorage.getItem('selectedTile') || this.selectedTile;
        this.selectedLayer = localStorage.getItem('selectedLayer') || this.selectedLayer;
        this.selectedLevel = this.gridService.getSelectedLevel();
    }
    beginCapture(x: number, y: number): void { this.beginDrag(x, y, true); }
    override beginDrag(x: number, y: number, capture = false): void {
        this.readPalette();
        this.startGesture(x, y, this.selectedLevel);
        this.mode = capture ? 'capture' : this.settings.tileMode;
        this.capturing = this.mode === 'capture';
        this.erasing = this.mode === 'eraser' || this.key === 'Control';
        if (this.mode === 'pick' || this.modifiers.alt) {
            const picked = this.gridService.getTileAt(x, y, this.selectedLevel, this.selectedLayer)?.name;
            if (picked) {
                this.selectedTile = picked; localStorage.setItem('selectedTile', picked); this.settings.stamp = undefined;
                this.settings.pickedTileChanges.next(picked);
            }
            this.cancel(); return;
        }
        if (this.mode === 'brush' || this.mode === 'eraser') this.stroke(x, y);
        this.hoverTile(x, y);
    }
    override hoverTile(x: number, y: number): void {
        if (!this.isDragging) this.readPalette();
        if (this.isDragging && ['brush', 'eraser'].includes(this.mode)) this.stroke(x, y);
        this.dragTiles = []; this.tileGhosts = [];
        const mode = this.isDragging ? this.mode : this.settings.tileMode;
        const erase = this.isDragging ? this.erasing : mode === 'eraser' || this.key === 'Control';
        const add = (cell: TileCellEdit) => {
            const t: SvgTile = { x: cell.x, y: cell.y, name: cell.tile || '', url: cell.tile ? this.gridService.getIndividualTile(cell.tile) : '',
                level: this.selectedLevel, layer: this.selectedLayer };
            this.dragTiles.push(t); if (cell.tile && !erase && mode !== 'capture' && mode !== 'pick') this.tileGhosts.push(t);
        };
        if (this.isDragging && ['brush', 'eraser'].includes(mode)) this.cells.forEach(add);
        else if (this.isDragging && ['rectangle', 'capture'].includes(mode)) {
            const area = tileAreaBetween(this.beginDragCoords[0], this.beginDragCoords[1], x, y);
            for (let j = area.y; j < area.y + area.height; j++) for (let i = area.x; i < area.x + area.width; i++) add({ x: i, y: j, tile: this.selectedTile });
        } else if (mode === 'brush' && this.settings.stamp) this.settings.stamp.cells.forEach(cell => add({ ...cell, x: x + cell.x, y: y + cell.y }));
        else add({ x, y, tile: this.selectedTile });
    }
    private stroke(x: number, y: number): void {
        const start = this.last || { x, y }, steps = Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
        for (let i = 0; i <= steps; i++) {
            const sx = Math.round(start.x + (x - start.x) * (steps ? i / steps : 0));
            const sy = Math.round(start.y + (y - start.y) * (steps ? i / steps : 0));
            const stamp = this.settings.stamp?.cells || [{ x: 0, y: 0, tile: this.selectedTile }];
            for (const cell of stamp) {
                const edit = { x: sx + cell.x, y: sy + cell.y, tile: this.erasing ? null : cell.tile };
                this.cells.set(`${edit.x}:${edit.y}`, edit);
            }
        }
        this.last = { x, y };
    }
    override endDrag(x: number, y: number): void {
        const mode = this.mode, erasing = this.erasing;
        if (this.isDragging && ['brush', 'eraser'].includes(mode)) this.stroke(x, y);
        const cells = [...this.cells.values()];
        const start = this.finishGesture(this.gridService.getSelectedLevel()); if (!start) return;
        const area = tileAreaBetween(start.x, start.y, x, y);
        if (mode === 'capture') {
            const tiles = this.gridService.userTiles.filter(t => t.level === start.level && t.layer === this.selectedLayer
                && t.x >= area.x && t.x < area.x + area.width && t.y >= area.y && t.y < area.y + area.height);
            this.settings.stamp = tiles.length ? { width: area.width, height: area.height,
                cells: tiles.map(t => ({ x: t.x - area.x, y: t.y - area.y, tile: t.name! })) } : undefined;
            this.settings.message = tiles.length ? `Captured ${tiles.length} manual tiles. Use Brush to stamp the pattern.` : 'No manual tiles on this layer to capture.';
            if (tiles.length) this.settings.tileMode = 'brush';
            return;
        }
        if (mode === 'fill') {
            let b: fromRoot.State['building'];
            this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(value => b = value);
            if (!b || !gridContains(b.width + 1, b.height + 1, x, y)) return;
            const source = this.gridService.getTileAt(x, y, start.level, this.selectedLayer)?.name;
            const visited = new Set<string>(), queue = [{ x, y }], fill: TileCellEdit[] = [];
            for (let i = 0; i < queue.length; i++) {
                const p = queue[i], key = `${p.x}:${p.y}`;
                if (visited.has(key) || !gridContains(b.width + 1, b.height + 1, p.x, p.y)) continue;
                visited.add(key);
                if (this.gridService.getTileAt(p.x, p.y, start.level, this.selectedLayer)?.name !== source) continue;
                fill.push({ ...p, tile: erasing ? null : this.selectedTile });
                queue.push({ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 });
            }
            this.store.dispatch(new PaintTileCells(start.level, this.selectedLayer, fill));
        } else if (mode === 'brush' || mode === 'eraser') this.store.dispatch(new PaintTileCells(start.level, this.selectedLayer, cells));
        else if (mode === 'rectangle') this.store.dispatch(new EditTiles(area, start.level, this.selectedLayer, erasing ? null : this.selectedTile));
    }
    override clickTile(x: number, y: number): void { this.beginDrag(x, y); this.endDrag(x, y); }
    override getTileFill(x: number, y: number): string {
        return this.dragTiles.some(t => t.x === x && t.y === y) ? this.key === 'Control' || this.settings.tileMode === 'eraser' ? '#00000070' : '#27276750' : '#00000000';
    }
}
