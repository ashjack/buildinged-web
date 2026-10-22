import { SvgTile } from "../models/app.models";
import { GridService } from "../services/grid.service";
import ToolDraw from "./tool-draw";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { eraseProjectedObjects, tileAreaBetween } from '../utils/tool-placement';
import { VisualFurniture } from "../models/furniture-window.models";
import { FurnitureService } from "../services/furniture.service";
import { combineLatest, take } from "rxjs";

export default class ToolFurniture extends ToolDraw {
    

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
       
          combineLatest([
            this.store.select(fromRoot.getSelectedFurniture),
            this.store.select(fromRoot.getSelectedFurnitureOrient)
        ]).pipe(take(1)).subscribe(([furn, orient]) => {
            this.tileGhosts = [];

            let newOrient = orient;
                if(x2 < x1) { newOrient = 'W' }
                if(x2 > x1) { newOrient = 'E' }
                if(y2 < y1) { newOrient = 'N' }
                if(y2 > y1) { newOrient = 'S' }

            furn?.entries.find(x => x.orient == newOrient)?.tiles.forEach((fTile) => {

                let newLayer = 'Furniture';
                if(this.gridService.getTileAt(x1 + fTile.x, y1 + fTile.y, this.selectedLevel, 'Furniture'))
                { newLayer = 'Furniture2' }
                if(this.gridService.getTileAt(x1 + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture2'))
                { newLayer = 'Furniture3' }
                if(this.gridService.getTileAt(x1 + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture3'))
                { newLayer = 'Furniture4' }
                if(this.gridService.getTileAt(x1 + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture4'))
                { newLayer = 'Furniture' }

                const tile: SvgTile = {
                    name: fTile.name,
                    url: fTile.url,
                    x: x1 + fTile.x,
                    y: y1 + fTile.y, 
                    layer: newLayer,
                    level: this.selectedLevel,
                    object: true
                };
                this.dragTiles = [];
                this.dragTiles.push({name: '', url: '', x: x1, y: y1, level: this.selectedLevel, layer: 'Walls'});
                if(this.key !== 'Control') {
                    this.tileGhosts.push(tile);
                }
            });
        });
        }
    
        if(!this.isDragging)
        {
            combineLatest([
                this.store.select(fromRoot.getSelectedFurniture),
                this.store.select(fromRoot.getSelectedFurnitureOrient)
            ]).pipe(take(1)).subscribe(([furn, orient]) => {
                this.tileGhosts = [];
                furn?.entries.find(x => x.orient == orient)?.tiles.forEach((fTile) => {

                    let newLayer = 'Furniture';
                    if(this.gridService.getTileAt(x + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture'))
                    { newLayer = 'Furniture2' }
                    if(this.gridService.getTileAt(x + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture2'))
                    { newLayer = 'Furniture3' }
                    if(this.gridService.getTileAt(x + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture3'))
                    { newLayer = 'Furniture4' }
                    if(this.gridService.getTileAt(x + fTile.x, y + fTile.y, this.selectedLevel, 'Furniture4'))
                    { newLayer = 'Furniture' }

                    const tile: SvgTile = {
                        name: fTile.name,
                        url: fTile.url,
                        x: x + fTile.x,
                        y: y + fTile.y, 
                        layer: newLayer,
                        level: this.selectedLevel,
                        object: true
                    };
                    this.dragTiles = [];
                    this.dragTiles.push({name: '', url: '', x: x, y: y, level: this.selectedLevel, layer: 'Walls'});
                    if(this.key !== 'Control') {
                        this.tileGhosts.push(tile);
                    }
                });
            });
        }
    }

    override beginDrag(x: number, y: number): void {
        this.selectedLevel = this.gridService.getSelectedLevel();
        this.startGesture(x, y, this.selectedLevel);
    }
    override endDrag(x: number, y: number): void {
        const start = this.finishGesture(this.gridService.getSelectedLevel());
        if (!start) return;
        if (this.key === 'Control') {
            eraseProjectedObjects(this.store, this.gridService, tileAreaBetween(start.x, start.y, x, y), start.level, 'furniture');
            return;
        }
        combineLatest([
            this.store.select(fromRoot.getSelectedFurniture), this.store.select(fromRoot.getSelectedFurnitureOrient),
        ]).pipe(take(1)).subscribe(([furniture, orient]) => {
            if (!furniture) return;
            if (x < start.x) orient = 'W';
            if (x > start.x) orient = 'E';
            if (y < start.y) orient = 'N';
            if (y > start.y) orient = 'S';
            this.furnitureService.placeFurniture(start.x, start.y, start.level, orient, furniture);
        });
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
        this.beginDrag(x, y); this.endDrag(x, y);
    }
}
