import { Building, SvgTile } from "../models/app.models";
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
    private hoveredEdge = '';
    private gestureOrient = '';

    constructor(private gridService: GridService,
                private store: Store<fromRoot.State>,
                private furnitureService: FurnitureService) {
        super();
    }

    override hoverTile(x: number, y: number, closestEdge = '') {
        this.selectedLevel = this.gridService.getSelectedLevel();
        if (!this.isDragging) this.hoveredEdge = closestEdge;
        const anchorX = this.isDragging ? this.beginDragCoords[0] : x;
        const anchorY = this.isDragging ? this.beginDragCoords[1] : y;
        combineLatest([
            this.store.select(fromRoot.getSelectedFurniture), this.store.select(fromRoot.getSelectedFurnitureOrient),
            this.store.select(fromRoot.getBuilding),
        ]).pipe(take(1)).subscribe(([furniture, orient, building]) => {
            this.dragTiles = [];
            this.tileGhosts = [];
            if (!furniture) return;
            const facing = this.isDragging
                ? this.dragOrientation(furniture, this.gestureOrient || orient, anchorX, anchorY, x, y)
                : this.wallOrientation(building, furniture, orient, x, y);
            furniture.entries.find(entry => entry.orient === facing)?.tiles.forEach(fTile => {
                let layer = 'Furniture';
                for (const [occupied, next] of [
                    ['Furniture', 'Furniture2'], ['Furniture2', 'Furniture3'],
                    ['Furniture3', 'Furniture4'], ['Furniture4', 'Furniture'],
                ]) {
                    if (this.gridService.getTileAt(anchorX + fTile.x, anchorY + fTile.y, this.selectedLevel, occupied)) layer = next;
                }
                this.dragTiles = [{ name: '', url: '', x: anchorX, y: anchorY, level: this.selectedLevel, layer: 'Walls' }];
                if (this.key !== 'Control') this.tileGhosts.push({
                    name: fTile.name, url: fTile.url, x: anchorX + fTile.x, y: anchorY + fTile.y,
                    layer, level: this.selectedLevel, object: true,
                });
            });
        });
    }

    override beginDrag(x: number, y: number): void {
        this.selectedLevel = this.gridService.getSelectedLevel();
        this.startGesture(x, y, this.selectedLevel);
        combineLatest([
            this.store.select(fromRoot.getSelectedFurniture), this.store.select(fromRoot.getSelectedFurnitureOrient),
            this.store.select(fromRoot.getBuilding),
        ]).pipe(take(1)).subscribe(([furniture, orient, building]) => {
            this.gestureOrient = furniture ? this.wallOrientation(building, furniture, orient, x, y) : orient;
        });
    }
    override endDrag(x: number, y: number): void {
        const initialOrient = this.gestureOrient;
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
            orient = this.dragOrientation(furniture, initialOrient || orient, start.x, start.y, x, y);
            this.furnitureService.placeFurniture(start.x, start.y, start.level, orient, furniture);
        });
    }

    private hasOrientation(furniture: VisualFurniture, orient: string): boolean {
        return furniture.entries.some(entry => entry.orient === orient && entry.tiles.length > 0);
    }

    private dragOrientation(furniture: VisualFurniture, fallback: string, startX: number, startY: number, x: number, y: number): string {
        if (x === startX && y === startY) return fallback;
        const dx = (this.pointerPosition?.x ?? x + .5) - startX - .5;
        const dy = (this.pointerPosition?.y ?? y + .5) - startY - .5;
        const angle = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
        const corner = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][Math.floor((angle + 22.5) / 45) % 8];
        if (furniture.corners && this.hasOrientation(furniture, corner)) return corner;
        const cardinal = ['E', 'N', 'W', 'S'][Math.floor((angle + 45) / 90) % 4];
        return this.hasOrientation(furniture, cardinal) ? cardinal : fallback;
    }

    private wallOrientation(building: Building | undefined, furniture: VisualFurniture, fallback: string, x: number, y: number): string {
        if (this.key === 'Control') return fallback;
        const wall = (cx: number, cy: number, axis: string) => ['Walls', 'Walls2'].some(layer => {
            const tile = this.gridService.getTileAt(cx, cy, this.selectedLevel, layer);
            if (!tile) return false;
            const name = tile.name?.replace(/\.png$/i, '');
            const orientation = tile.orient || building?.entries.filter(entry => /walls$/.test(entry.category))
                .flatMap(entry => entry.tiles).find(entry => entry.tile === name)?.enum;
            if (orientation === 'NW' || orientation === 'NorthWest') return axis === 'W' || axis === 'N';
            if (axis === 'SE') return orientation === 'SE' || orientation === 'SouthEast';
            return orientation === axis || !!orientation?.startsWith(axis === 'W' ? 'West' : 'North');
        });
        const north = wall(x, y, 'N'), west = wall(x, y, 'W');
        const east = wall(x + 1, y, 'W'), south = wall(x, y + 1, 'N');
        let facing = '';
        if (north && west) facing = 'NW';
        else if (wall(x + 1, y + 1, 'SE')) facing = 'SE';
        else if (north) facing = east ? 'NE' : 'N';
        else if (west) facing = south ? 'SW' : 'W';
        else if (east && south) facing = 'SE';
        else if (east) facing = 'E';
        else if (south) facing = 'S';
        if (!facing) return fallback;
        if (facing.length === 2 && !(furniture.corners && this.hasOrientation(furniture, facing))) {
            const useHorizontal = facing[0] === 'N'
                ? this.hoveredEdge === facing[1] || this.hoveredEdge === 'S'
                : this.hoveredEdge === facing[1] || this.hoveredEdge === 'N';
            facing = useHorizontal ? facing[1] : facing[0];
        }
        return this.hasOrientation(furniture, facing) ? facing : fallback;
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
