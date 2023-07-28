import { SvgTile } from "../models/app.models";
import { ViewportComponent } from "../viewport/viewport.component";
import ToolDraw from "./tool-draw";

export default class ToolTile extends ToolDraw {
    
    tileGhosts: SvgTile[] = [];

    selectedTile: string = 'tile_0.png';
    selectedLayer: string = 'Walls';

    constructor(grid: ViewportComponent) {
        super(grid);
    }

    override hoverTile(x: number, y: number) {

        this.selectedTile = localStorage.getItem('selectedTile')!;
        this.selectedLayer = localStorage.getItem('selectedLayer')!;
    
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
                name: this.selectedTile,
                url: this.grid.getIndividualTile(this.selectedTile),
                x: i,
                y: j,
                layer: this.selectedLayer
              };
              this.dragTiles.push(tile);
              this.tileGhosts.push(tile);
            }
          }
        }
    
        if(!this.isDragging)
        {
        this.tileGhosts = [];
        const tile: SvgTile = {
          name: this.selectedTile,
          url: this.grid.getIndividualTile(this.selectedTile),
          x: x,
          y: y, 
          layer: this.selectedLayer
        };
        this.tileGhosts.push(tile);
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
                const tile: SvgTile = {
                    name: this.selectedTile,
                    url: this.selectedTile,
                    x: i,
                    y: j,
                    layer: this.selectedLayer
                };
                this.grid.placeTile2(tile, false);
            }
        }
    }

    override getTileFill(x: number, y: number): string {
    
        if(this.dragTiles.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
        {
          return '#27276750';
        }
    
        if(this.tileGhosts.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
        {
          return '#27455d50';
        }
        
        return '#34343400'
      }

    override clickTile(x: number, y: number): void {
        const tile: SvgTile = {
            name: this.selectedTile,
            url: this.selectedTile,
            x: x,
            y: y,
            layer: this.selectedLayer
        };
        this.grid.placeTile2(tile, false);
    }
}