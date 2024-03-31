import { SvgTile } from "../models/app.models";
import { GridService } from "../services/grid.service";
import ToolDraw from "./tool-draw";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { AddTile } from "../app.actions";
import { VisualFurniture } from "../models/furniture-window.models";
import { FurnitureService } from "../services/furniture.service";

export default class ToolFurniture extends ToolDraw {
    
    tileGhosts: SvgTile[] = [];

    selectedFurniture: VisualFurniture | undefined;
    selectedLevel: number = 0;

    constructor(private gridService: GridService,
                private store: Store<fromRoot.State>,
                private furnitureService: FurnitureService) {
        super();
    }

    override hoverTile(x: number, y: number) {

        this.selectedLevel = this.gridService.getSelectedLevel();
    
        if(this.isDragging)
        {
        //   this.dragTiles = [];
        //   this.tileGhosts = [];
        //   const x1 = this.beginDragCoords[0];
        //   const y1 = this.beginDragCoords[1];
        //   const x2 = x;
        //   const y2 = y;
        //   const xMin = Math.min(x1, x2);
        //   const xMax = Math.max(x1, x2);
        //   const yMin = Math.min(y1, y2);
        //   const yMax = Math.max(y1, y2);
        //   for(let i = xMin; i <= xMax; i++)
        //   {
        //     for(let j = yMin; j <= yMax; j++)
        //     {
        //       const tile: SvgTile = {
        //         name: this.selectedTile,
        //         url: this.gridService.getIndividualTile(this.selectedTile),
        //         x: i,
        //         y: j,
        //         layer: this.selectedLayer,
        //         level: this.selectedLevel
        //       };
        //       this.dragTiles.push(tile);
        //       if(this.key !== 'Control')
        //       {
        //         this.tileGhosts.push(tile);
        //       }
        //     }
        //   }
        }
    
        if(!this.isDragging)
        {
            this.store.select(fromRoot.getSelectedFurniture).subscribe((furn) => {
                this.tileGhosts = [];
                furn?.entries.find(x => x.orient == 'W')?.tiles.forEach((fTile) => {
                    const tile: SvgTile = {
                        name: fTile.name,
                        url: fTile.url,
                        x: x + fTile.x,
                        y: y + fTile.y, 
                        layer: 'Furniture',
                        level: this.selectedLevel,
                        object: true
                    };
                    this.dragTiles = [];
                    this.dragTiles.push({name: '', url: '', x: x, y: y, level: this.selectedLevel, layer: 'Walls'});
                    if(this.key !== 'Control')
                    {
                        this.tileGhosts.push(tile);
                    }
                })
            })
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

        this.store.select(fromRoot.getSelectedFurniture).subscribe((furn) => {
            if(furn)
            {
                this.furnitureService.placeFurniture(x1, y1, this.selectedLevel, 'W', furn)
            }
        })

        for(let i = xMin; i <= xMax; i++)
        {
            for(let j = yMin; j <= yMax; j++)
            {
              if(this.key === 'Control')
              {
                //this.gridService.userTiles = this.gridService.userTiles.filter((tile: SvgTile) => {return tile.x !== i || tile.y !== j || tile.layer !== this.selectedLayer;});
              }
              else
              {
                
                // const tile: SvgTile = {
                //     name: this.selectedTile,
                //     url: this.selectedTile,
                //     x: i,
                //     y: j,
                //     layer: this.selectedLayer,
                //     level: this.selectedLevel
                // };
                // this.gridService.placeTile2(tile, false);
                // this.store.dispatch(new AddTile(i, j, this.selectedLevel, this.selectedLayer, this.selectedTile))
              }
            }
        }

        this.gridService.redrawTiles();
    }

    override getTileFill(x: number, y: number): string {
    
        if(this.key === 'Control')
        {
          return '#00000070';
        }
        if(this.dragTiles.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
        {
          return '#27276750';
        }
    
        if(this.tileGhosts.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
        {
          return '#27455d50';
        }
        
        return '#19a0e350'
      }

    override clickTile(x: number, y: number): void {
        // const tile: SvgTile = {
        //     name: this.selectedTile,
        //     url: this.selectedTile,
        //     x: x,
        //     y: y,
        //     layer: this.selectedLayer,
        //     level: this.selectedLevel
        // };
        // this.gridService.placeTile2(tile, false);
        this.store.select(fromRoot.getSelectedFurniture).subscribe((furn) => {
            if(furn)
            {
                this.furnitureService.placeFurniture(x, y, this.selectedLevel, 'W', furn)
            }
        })
    }
}