import { SvgTile } from "../models/app.models";
import { FurnitureService } from "../services/furniture.service";
import { ViewportComponent } from "../viewport/viewport.component";
import ToolDraw from "./tool-draw";

export default class ToolRoof extends ToolDraw {
    
    constructor(grid: ViewportComponent, private furnitureService: FurnitureService) {
        super(grid);
    }

    setRoof(x: number, y: number): void {
        this.furnitureService.objects.push({
            type: "roof",
            width: 1 ,
            height: 1,
            RoofType: "PeakNS",
            Depth: "Point5",
            cappedW: "true",
            cappedN: "true",
            cappedE: "true",
            cappedS: "true",
            CapTiles: "47",
            SlopeTiles: "49",
            TopTiles: "50",
            x: 1,
            y: 0
        })
    }

    override hoverTile(x: number, y: number): void {
        if(this.isDragging)
        {
          this.dragTiles = [];
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
                name: '',
                url: '',
                x: i,
                y: j, 
                layer: 'Walls'
              };
              this.dragTiles.push(tile);
            }
          }
        }
        else
        {
            this.dragTiles = [];
            this.dragTiles.push({name: '', url: '', x: x, y: y, layer: 'Walls'});
        }
    }

    override beginDrag(x: number, y: number): void {
        this.beginDragCoords = [x, y];
        this.isDragging = true;
    }

    override endDrag(x: number, y: number): void {
        this.isDragging = false;
        this.dragTiles = [];
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
                //Set roof
                //this.setRoom(i,j);
            }
        }

        //Draw roof
        //this.drawRoom(this.grid.rooms[this.grid.rooms.length - 1]);
    }

    override clickTile(x: number, y: number): void {

    }

    override getTileFill(x: number, y: number): string {
        if(this.dragTiles.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
        {
          return '#05ff2250';
        }
        
        return '#34343400'
    }
}