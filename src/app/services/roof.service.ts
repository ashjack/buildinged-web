import { Injectable } from "@angular/core";
import { Store } from "@ngrx/store";
import { take } from "rxjs";
import { AddObject, UpdateObject } from "../app.actions";
import * as fromRoot from '../app.reducers';
import { SvgTile, TileArea } from "../models/app.models";
import { canPlaceObject, eraseProjectedObjects } from '../utils/tool-placement';
import { BuildingService } from "./building.service";
import { GridService } from "./grid.service";
import { GUID } from "../utils/guid";
import { ROOF_OPTIONS, buildRoofPlacements, calculateRoofDepth, defaultRoofCaps, getRoofOptionById, normalizeRoofSize } from "./roof-patterns";
import { generateBuildingSquares } from './native-squares';
import { resizeNativeRoof } from '../utils/native-roof';
import { validObject } from '../utils/selection-edits';

@Injectable({
    providedIn: 'root',
})
export class RoofService {
    constructor(private buildingService: BuildingService, private gridService: GridService, private store: Store<fromRoot.State>) { }

    roofOptions = ROOF_OPTIONS;
    message = '';
    get building() { return this.buildingService.building; }
    createObject(x: number, y: number, type: string): any {
        const tiles = this.getRoofTileEntries(this.building);
        return resizeNativeRoof({ uid: GUID.generateGUID(), type: 'roof', x, y, RoofType: type, Depth: 'Zero',
            ...defaultRoofCaps(type), CapTiles: tiles.cap, SlopeTiles: tiles.slope, TopTiles: tiles.top }, 1, 1, false);
    }
    commit(object: any, level: number, resizing: boolean): void {
        if (!this.building?.floors[level] || !validObject(this.building, object)) return;
        if (resizing) this.store.dispatch(new UpdateObject(object.uid, { width: object.width, height: object.height, Depth: object.Depth }));
        else this.store.dispatch(new AddObject(object, level));
    }
    update(uid: string, changes: Record<string, unknown>): void { this.store.dispatch(new UpdateObject(uid, changes)); }
    preview(object: any, level: number): SvgTile[] {
        const b = this.building;
        return generateBuildingSquares({ ...b, floors: b.floors.map((f, i) => i === level
            ? { ...f, objects: f.objects.some(o => o.uid === object.uid) ? f.objects.map(o => o.uid === object.uid ? object : o) : [...f.objects, object] } : f) }).tiles;
    }

    getSelectedRoofOptionId(): string {
        return localStorage.getItem('selectedRoofOptionId') || 'peak-vertical';
    }

    setSelectedRoofOptionId(optionId: string): void {
        localStorage.setItem('selectedRoofOptionId', optionId);
    }

    getSelectedRoofOption() {
        return getRoofOptionById(this.getSelectedRoofOptionId());
    }

    getSelectedRoofType(): string {
        return this.getSelectedRoofOption().roofType;
    }

    placeRoof(x: number, y: number, level: number, width: number, height: number, RoofType: string) {
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(b => {
            if (!b || !Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
                return;
            }

            const { width: roofWidth, height: roofHeight } = normalizeRoofSize(width + 1, height + 1, RoofType);
            if (!ROOF_OPTIONS.some(option => option.roofType === RoofType) || !canPlaceObject(b, x, y, level, roofWidth, roofHeight)) return;
            const depth = this.calculateDepth(roofWidth, roofHeight, RoofType);
            const tileEntries = this.getRoofTileEntries(b);

            const newRoof = {
                uid: GUID.generateGUID(),
                type: 'roof',
                width: roofWidth,
                height: roofHeight,
                RoofType: RoofType,
                Depth: depth,
                ...defaultRoofCaps(RoofType),
                CapTiles: tileEntries.cap,
                SlopeTiles: tileEntries.slope,
                TopTiles: tileEntries.top,
                x: x,
                y: y,
            };

            this.store.dispatch(new AddObject(newRoof, level));
        });
    }

    calculateDepth(width: number, height: number, RoofType: string) {
        return calculateRoofDepth(width, height, RoofType);
    }

    eraseRoofs(area: TileArea, level: number): void {
        eraseProjectedObjects(this.store, this.gridService, area, level, 'roof');
    }

    calculateRoofTiles(x: number, y: number, level: number, width: number, height: number, RoofType: string) {
        const building = this.buildingService.getBuilding();
        if (!building) {
            return [] as SvgTile[];
        }

        const tileEntries = this.getRoofTileEntries(building);
        const capTiles = building.entries[tileEntries.cap - 1]?.tiles || [];
        const slopeTiles = building.entries[tileEntries.slope - 1]?.tiles || [];
        const topTiles = building.entries[tileEntries.top - 1]?.tiles || [];

        return buildRoofPlacements({
            x,
            y,
            level,
            width,
            height,
            roofType: RoofType,
            ...defaultRoofCaps(RoofType),
            tileset: {
                capTiles,
                slopeTiles,
                topTiles,
            },
            hasRoofTile: (roofX, roofY, roofLevel) => this.gridService.tileExists(roofX, roofY, roofLevel, 'Roof'),
            isManualRoofTile: (roofX, roofY, roofLevel) => this.gridService.isUserTile(roofX, roofY, roofLevel, 'Roof'),
            hasRoofCapTile: (roofX, roofY, roofLevel) => this.gridService.tileExists(roofX, roofY, roofLevel, 'RoofCap'),
            isManualRoofCapTile: (roofX, roofY, roofLevel) => this.gridService.isUserTile(roofX, roofY, roofLevel, 'RoofCap'),
            hasFloorTile: (floorX, floorY, floorLevel) => this.gridService.tileExists(floorX, floorY, floorLevel, 'Floor'),
            isManualFloorTile: (floorX, floorY, floorLevel) => this.gridService.isUserTile(floorX, floorY, floorLevel, 'Floor'),
        });
    }

    private getRoofTileEntries(building: ReturnType<BuildingService['getBuilding']>): { cap: number; slope: number; top: number } {
        const resolveEntry = (configured: number, category: string): number => {
            if (configured === 0) return 0;
            if (building.entries[configured - 1]?.category === category) return configured;
            return building.entries.findIndex(entry => entry.category === category) + 1;
        };
        return {
            cap: resolveEntry(building.RoofCap, 'roof_caps'),
            slope: resolveEntry(building.RoofSlope, 'roof_slopes'),
            top: resolveEntry(building.RoofTop, 'roof_tops'),
        };
    }
}
