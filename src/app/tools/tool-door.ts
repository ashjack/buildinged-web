import { SvgTile } from "../models/app.models";
import { DoorService } from "../services/door.service";
import { GridService } from "../services/grid.service";
import ToolDraw from "./tool-draw";
import ToolPlace from "./tool-place";

export default class ToolDoor extends ToolDraw {

    doorTile = '';
    frameTile = '';
    archTile = '';

    tileGhosts: SvgTile[] = [];

    constructor(private doorService: DoorService, private gridService: GridService) {
        super();
    }

    override hoverTile(x: number, y: number, closestEdge?: string, closestCorner?: string) {

        const selectedTile = 'fixtures_doors_01_004.png';
        const selectedLayer = 'Doors';
        const selectedLevel = this.gridService.getSelectedLevel();
    
        if(this.isDragging)
        {
          this.dragTiles = [];
          this.tileGhosts = [];
          const x1 = this.beginDragCoords[0];
          const y1 = this.beginDragCoords[1];
          const x2 = x;
          const y2 = y;
          const xMin = Math.min(x1, x2);
          const xMax = Math.max(x1, x2);
          const yMin = Math.min(y1, y2);
          const yMax = Math.max(y1, y2);
          for(let i = xMin; i <= xMax; i++)
          {
            for(let j = yMin; j <= yMax; j++)
            {
              const tile: SvgTile = {
                name: selectedTile,
                url: this.gridService.getIndividualTile(selectedTile),
                x: i,
                y: j,
                layer: selectedLayer,
                level: selectedLevel
              };
              this.dragTiles.push(tile);
              if(this.key !== 'Control')
              {
                this.tileGhosts.push(tile);
              }
            }
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
        
        this.doorService.placeDoor(x, y, 0, 'W');
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