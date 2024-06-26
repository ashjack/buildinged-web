import { SvgTile } from "../models/app.models";
import { DoorService } from "../services/door.service";
import { GridService } from "../services/grid.service";
import ToolDraw from "./tool-draw";
import ToolPlace from "./tool-place";

export default class ToolDoor extends ToolDraw {

    doorTile = '';
    frameTile = '';
    archTile = '';

    edge = '';

    tileGhosts: SvgTile[] = [];

    constructor(private doorService: DoorService, private gridService: GridService) {
        super();
    }

    override hoverTile(x: number, y: number, closestEdge?: string, closestCorner?: string) {

        let selectedTile = 'fixtures_doors_01_005.png';
        const selectedLayer = 'Doors';
        const selectedLevel = this.gridService.getSelectedLevel();

        this.edge = closestEdge ?? '';
    
        if(closestEdge === 'N' || closestEdge === 'S')
        {
            selectedTile = 'fixtures_doors_01_005.png';
            if(closestEdge === 'S')
            {
                y += 1;
            }
        }
        else if(closestEdge === 'W' || closestEdge === 'E')
        {
            selectedTile = 'fixtures_doors_01_004.png';
            if(closestEdge === 'E')
            {
                x += 1;
            }
        }
    
        if(!this.isDragging)
        {
        this.tileGhosts = [];
        const tile: SvgTile = {
          name: selectedTile,
          url: this.gridService.getIndividualTile(selectedTile),
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
        this.doorService.placeDoor(x, y, 0, this.edge);
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