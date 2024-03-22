import { SvgTile } from "../models/app.models";
import { BuildingService } from "../services/building.service";
import { GridService } from "../services/grid.service";
import { WindowService } from "../services/window.service";
import ToolDraw from "./tool-draw";
import ToolPlace from "./tool-place";

export default class ToolWindow extends ToolDraw {

    windowTile = '';
    frameTile = '';
    archTile = '';

    edge = '';

    tileGhosts: SvgTile[] = [];

    constructor(private windowService: WindowService, private gridService: GridService, private buildingService: BuildingService) {
        super();
    }

    override hoverTile(x: number, y: number, closestEdge?: string, closestCorner?: string) 
    {
        const windowTiles = this.buildingService.getEntry(this.buildingService.building.Window);
        const curtainTiles = this.buildingService.getEntry(this.buildingService.building.Curtains);

        let selectedTile = windowTiles.tiles.find(x => x.enum == 'North');
        const selectedLayer = 'Windows';
        const selectedLevel = this.gridService.getSelectedLevel();

        this.edge = closestEdge ?? '';

        if(closestEdge === 'N' || closestEdge === 'S')
        {
            selectedTile = windowTiles.tiles.find(x => x.enum == 'North');
            if(closestEdge === 'S')
            {
                y += 1;
            }
        }
        else if(closestEdge === 'W' || closestEdge === 'E')
        {
            selectedTile = windowTiles.tiles.find(x => x.enum == 'West');
            if(closestEdge === 'E')
            {
                x += 1;
            }
        }
    
        if(!this.isDragging)
        {
        this.tileGhosts = [];
        const tile: SvgTile = {
          name: selectedTile?.tile + ".png",
          url: this.gridService.getIndividualTile(selectedTile + ".png"),
          x: x,
          y: y, 
          layer: selectedLayer,
          level: selectedLevel
        };
        this.dragTiles = [];
        this.tileGhosts.push(tile);
      }
    }
    
    override beginDrag(x: number, y: number): void {
    }

    override endDrag(x: number, y: number): void {
        if(this.edge === 'S')
        {
            y += 1;
            this.edge = 'N'
        }

        if(this.edge === 'E')
        {
            x += 1;
            this.edge = 'W'
        }
        this.windowService.placeWindow(x, y, 0, this.edge);
    }

    override clickTile(x: number, y: number): void {
        
    }

    // override getTilePlacement(x: number, y: number): void {
    //     throw new Error("Method not implemented.");
    // }

    override getTileFill(x: number, y: number): string {
        return '#ffffff';
    }

}