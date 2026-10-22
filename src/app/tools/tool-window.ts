import { GridService } from '../services/grid.service';
import { WindowService } from '../services/window.service';
import { BuildingService } from '../services/building.service';
import { wallEdgePlacement } from '../utils/tool-placement';
import ToolDraw from './tool-draw';

export default class ToolWindow extends ToolDraw {
    edge = '';

    constructor(private windowService: WindowService, private gridService: GridService, private buildingService: BuildingService) { super(); }

    override hoverTile(x: number, y: number, closestEdge?: string): void {
        this.edge = closestEdge || '';
        const placement = wallEdgePlacement(x, y, this.edge);
        const name = placement && this.windowService.getTile(placement.dir);
        this.tileGhosts = placement && name ? [{
            name: name + '.png', url: this.gridService.getIndividualTile(name + '.png'),
            x: placement.x, y: placement.y, layer: 'Windows', level: this.gridService.getSelectedLevel(),
        }] : [];
    }

    override beginDrag(x: number, y: number): void {
        this.startGesture(x, y, this.gridService.getSelectedLevel());
    }

    override endDrag(x: number, y: number): void {
        const start = this.finishGesture(this.gridService.getSelectedLevel());
        if (!start) return;
        const placement = wallEdgePlacement(x, y, this.edge);
        if (placement) this.windowService.placeWindow(placement.x, placement.y, start.level, placement.dir);
    }

    override clickTile(x: number, y: number): void {
        this.beginDrag(x, y); this.endDrag(x, y);
    }

    override getTileFill(x: number, y: number): string { return '#ffffff'; }
}
