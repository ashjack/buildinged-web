import { Building, Point, SvgObject, SvgTile } from "../models/app.models";
import { GridService } from "../services/grid.service";
import ToolDraw from "./tool-draw";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { canPlaceObject, eraseProjectedObjects, tileAreaBetween } from '../utils/tool-placement';
import { furnitureDefinition, furnitureEntryForPlacement, furnitureEntrySize, registerFurniture, wallFurnitureFits } from '../utils/furniture-definition';
import { generateBuildingSquares } from '../services/native-squares';
import { VisualFurniture } from "../models/furniture-window.models";
import { FurnitureService } from "../services/furniture.service";
import { combineLatest, take } from "rxjs";

export default class ToolFurniture extends ToolDraw {
    

    selectedFurniture: VisualFurniture | undefined;
    selectedLevel: number = 0;
    private hoveredEdge = '';
    private gestureOrient = '';
    private gestureAnchor?: Point;
    previewObject?: SvgObject;
    private wallPreview?: { building: Building; furniture: VisualFurniture; x: number; y: number; orient: string;
        level: number; projection: ReturnType<typeof generateBuildingSquares> };

    override cancel(): void { super.cancel(); this.gestureOrient = ''; this.gestureAnchor = undefined; this.previewObject = undefined; this.wallPreview = undefined; }

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
            this.previewTiles = undefined;
            this.previewObject = undefined;
            if (!furniture) return;
            if (!this.isDragging && !this.canHover(building, x, y)) return;
            const placement = this.isDragging
                ? { ...(this.gestureAnchor ?? { x: anchorX, y: anchorY }), orient: this.dragOrientation(furniture, this.gestureOrient || orient, anchorX, anchorY, x, y) }
                : this.placement(building, furniture, orient, x, y);
            if (furniture.layer === 'Walls' && building && this.key !== 'Control') {
                const entry = furnitureEntryForPlacement(furniture, placement.orient);
                if (!entry) return;
                const size = furnitureEntrySize(entry);
                if (!canPlaceObject(building, placement.x, placement.y, this.selectedLevel, size.width, size.height)
                    || !wallFurnitureFits(building, placement.x, placement.y, placement.orient, size)) return;
                const object = { uid: 'furniture-preview', type: 'furniture', x: placement.x, y: placement.y,
                    orient: placement.orient };
                const cached = this.wallPreview;
                if (!cached || cached.building !== building || cached.furniture !== furniture || cached.x !== placement.x
                    || cached.y !== placement.y || cached.orient !== placement.orient || cached.level !== this.selectedLevel) {
                    const registered = registerFurniture(building.furniture, furnitureDefinition(furniture));
                    const projection = generateBuildingSquares({ ...building, furniture: registered.furniture,
                        floors: building.floors.map((floor, level) => level === this.selectedLevel ? { ...floor,
                            objects: [...floor.objects, { ...object, FurnitureTiles: registered.index }] } : floor) });
                    this.wallPreview = { building, furniture, ...placement, level: this.selectedLevel, projection };
                }
                const projection = this.wallPreview!.projection;
                this.previewTiles = projection.tiles;
                this.tileGhosts = this.previewTiles.filter(tile => tile.object === object.uid && tile.level === this.selectedLevel);
                this.previewObject = projection.objects.find(item => item.uid === object.uid);
                return;
            }
            const shifted = ['Walls', 'RoofCap', 'Frames', 'Doors'].includes(furniture.layer ?? '');
            const dx = shifted && placement.orient === 'E' ? 1 : 0, dy = shifted && placement.orient === 'S' ? 1 : 0;
            furnitureEntryForPlacement(furniture, placement.orient)?.tiles.forEach(fTile => {
                const tx = placement.x + fTile.x + dx, ty = placement.y + fTile.y + dy;
                let layer = furniture.layer || 'Furniture';
                if (layer === 'Furniture') {
                    for (const [occupied, next] of [
                        ['Furniture', 'Furniture2'], ['Furniture2', 'Furniture3'],
                        ['Furniture3', 'Furniture4'], ['Furniture4', 'Furniture'],
                    ]) {
                        if (this.gridService.getTileAt(tx, ty, this.selectedLevel, occupied)) layer = next;
                    }
                }
                this.dragTiles = [{ name: '', url: '', x: placement.x + dx, y: placement.y + dy, level: this.selectedLevel, layer: 'Walls' }];
                if (this.key !== 'Control') this.tileGhosts.push({
                    name: fTile.name, url: fTile.url, x: tx, y: ty,
                    layer, level: this.selectedLevel, object: true,
                });
            });
        });
    }

    override beginDrag(x: number, y: number): void {
        this.selectedLevel = this.gridService.getSelectedLevel();
        combineLatest([
            this.store.select(fromRoot.getSelectedFurniture), this.store.select(fromRoot.getSelectedFurnitureOrient),
            this.store.select(fromRoot.getBuilding),
        ]).pipe(take(1)).subscribe(([furniture, orient, building]) => {
            if (!this.canHover(building, x, y)) { this.cancel(); return; }
            this.startGesture(x, y, this.selectedLevel);
            const placement = furniture ? this.placement(building, furniture, orient, x, y) : { x, y, orient };
            this.gestureOrient = placement.orient; this.gestureAnchor = { x: placement.x, y: placement.y };
            if (this.key !== 'Control') this.hoverTile(x, y, this.hoveredEdge);
        });
    }
    override endDrag(x: number, y: number): void {
        const initialOrient = this.gestureOrient;
        const anchor = this.gestureAnchor;
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
            this.furnitureService.placeFurniture(anchor?.x ?? start.x, anchor?.y ?? start.y, start.level, orient, furniture);
        });
    }

    private hasOrientation(furniture: VisualFurniture, orient: string): boolean {
        return !!furnitureEntryForPlacement(furniture, orient);
    }

    private canHover(building: Building | undefined, x: number, y: number): boolean {
        return canPlaceObject(building, x, y, this.selectedLevel)
            && (this.key === 'Control' || x < building!.width && y < building!.height);
    }

    private placement(building: Building | undefined, furniture: VisualFurniture, fallback: string, x: number, y: number) {
        if (furniture.layer === 'Walls' && this.key !== 'Control') {
            const edge = this.hoveredEdge;
            const axis = ['W', 'E'].includes(edge) ? 'W' : 'N';
            const onWall = ['W', 'N', 'E', 'S'].includes(edge) && this.wallAt(building,
                x + (edge === 'E' ? 1 : 0), y + (edge === 'S' ? 1 : 0), axis);
            const orient = onWall && this.hasOrientation(furniture, edge) ? edge : fallback;
            const size = furnitureEntrySize(furnitureEntryForPlacement(furniture, orient));
            const lineX = this.pointerPosition ? Math.round(this.pointerPosition.x) : x + (this.hoveredEdge === 'E' ? 1 : 0);
            const lineY = this.pointerPosition ? Math.round(this.pointerPosition.y) : y + (this.hoveredEdge === 'S' ? 1 : 0);
            // An existing wall determines the facing; empty grid lines use the sidebar choice.
            const anchor = { x: ['W', 'E'].includes(orient) ? lineX - (orient === 'E' ? size.width : 0) : x,
                y: ['N', 'S'].includes(orient) ? lineY - (orient === 'S' ? size.height : 0) : y };
            // Fit larger pieces along the line without moving them to another line.
            if (building && ['N', 'S'].includes(orient)) anchor.x = Math.min(anchor.x, building.width - size.width);
            if (building && ['W', 'E'].includes(orient)) anchor.y = Math.min(anchor.y, building.height - size.height);
            return { ...anchor, orient };
        }
        const wall = this.key === 'Control' ? '' : this.wallFacing(building, x, y);
        const orient = this.wallOrientation(furniture, fallback, wall);
        const size = furnitureEntrySize(furnitureEntryForPlacement(furniture, orient));
        // FurnitureTool::updateCursorObject keeps the far end of a larger object on the hovered wall.
        return { orient, x: x - (['E', 'NE', 'SE'].includes(wall) ? size.width - 1 : 0),
            y: y - (['S', 'SW', 'SE'].includes(wall) ? size.height - 1 : 0) };
    }

    private dragOrientation(furniture: VisualFurniture, fallback: string, startX: number, startY: number, x: number, y: number): string {
        if (furniture.layer === 'Walls') return fallback;
        if (x === startX && y === startY) return fallback;
        const dx = (this.pointerPosition?.x ?? x + .5) - startX - .5;
        const dy = (this.pointerPosition?.y ?? y + .5) - startY - .5;
        const angle = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
        const corner = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][Math.floor((angle + 22.5) / 45) % 8];
        if (furniture.corners && this.hasOrientation(furniture, corner)) return corner;
        const cardinal = ['E', 'N', 'W', 'S'][Math.floor((angle + 45) / 90) % 4];
        return this.hasOrientation(furniture, cardinal) ? cardinal : fallback;
    }

    private wallAt(building: Building | undefined, x: number, y: number, axis: string): boolean {
        return ['Walls', 'Walls2'].some(layer => {
            const tile = this.gridService.getTileAt(x, y, this.selectedLevel, layer);
            if (!tile) return false;
            const name = tile.name?.replace(/\.png$/i, '');
            const orientation = tile.orient || building?.entries.filter(entry => /walls$/.test(entry.category))
                .flatMap(entry => entry.tiles).find(entry => entry.tile === name)?.enum;
            if (orientation === 'NW' || orientation === 'NorthWest') return axis === 'W' || axis === 'N';
            if (axis === 'SE') return orientation === 'SE' || orientation === 'SouthEast';
            return orientation === axis || !!orientation?.startsWith(axis === 'W' ? 'West' : 'North');
        });
    }

    private wallFacing(building: Building | undefined, x: number, y: number): string {
        const wall = (cx: number, cy: number, axis: string) => this.wallAt(building, cx, cy, axis);
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
        return facing;
    }

    private wallOrientation(furniture: VisualFurniture, fallback: string, facing: string): string {
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
