import { GridService } from '../services/grid.service';
import { WindowService } from '../services/window.service';
import { BuildingService } from '../services/building.service';
import { canPlaceObject, wallEdgePlacement } from '../utils/tool-placement';
import ToolDraw from './tool-draw';
import { generateBuildingSquares } from '../services/native-squares';
import { Building, SvgTile } from '../models/app.models';

export default class ToolWindow extends ToolDraw {
    edge = '';
    private preview?: { building: Building; x: number; y: number; dir: string; level: number; tiles: SvgTile[] };
    override cancel(): void { super.cancel(); this.preview = undefined; }

    constructor(private windowService: WindowService, private gridService: GridService, private buildingService: BuildingService) { super(); }

    override hoverTile(x: number, y: number, closestEdge?: string): void {
        this.edge = closestEdge || '';
        const placement = wallEdgePlacement(x, y, this.edge);
        const name = placement && this.windowService.getTile(placement.dir);
        const building = this.buildingService.building, level = this.gridService.getSelectedLevel();
        this.previewTiles = undefined;
        if (placement && building && canPlaceObject(building, placement.x, placement.y, level)) {
            const cached = this.preview;
            if (!cached || cached.building !== building || cached.level !== level || cached.x !== placement.x || cached.y !== placement.y || cached.dir !== placement.dir) {
                const object = { ...placement, uid: 'window-preview', type: 'window', Tile: building.Window,
                    CurtainsTile: building.Curtains, ShuttersTile: building.Shutters };
                const tiles = generateBuildingSquares({ ...building, floors: building.floors.map((floor, index) => index === level
                    ? { ...floor, objects: [...floor.objects, object] } : floor) }).tiles;
                this.preview = { building, level, ...placement, tiles };
            }
            this.previewTiles = this.preview!.tiles;
        }
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
