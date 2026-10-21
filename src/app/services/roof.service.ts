import { Injectable } from "@angular/core";
import { Store } from "@ngrx/store";
import { take } from "rxjs";
import { AddObject } from "../app.actions";
import * as fromRoot from '../app.reducers';
import { SvgTile } from "../models/app.models";
import { BuildingService } from "./building.service";
import { GridService } from "./grid.service";
import { GUID } from "../utils/guid";
import { ROOF_OPTIONS, buildRoofPlacements, calculateRoofDepth, getRoofOptionById, normalizeRoofSize } from "./roof-patterns";

@Injectable({
    providedIn: 'root',
})
export class RoofService {
    constructor(private buildingService: BuildingService, private gridService: GridService, private store: Store<fromRoot.State>) { }

    roofOptions = ROOF_OPTIONS;

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
            if (!b) {
                return;
            }

            const { width: roofWidth, height: roofHeight } = normalizeRoofSize(width + 1, height + 1, RoofType);
            const depth = this.calculateDepth(roofWidth, roofHeight, RoofType);
            const tileEntries = this.getRoofTileEntries(b);

            const newRoof = {
                uid: GUID.generateGUID(),
                type: 'roof',
                width: roofWidth,
                height: roofHeight,
                RoofType: RoofType,
                Depth: depth,
                cappedW: 'true',
                cappedN: 'true',
                cappedE: 'true',
                cappedS: 'true',
                CapTiles: tileEntries.cap,
                SlopeTiles: tileEntries.slope,
                TopTiles: tileEntries.top,
                x: x,
                y: y,
            };

            this.store.dispatch(new AddObject(newRoof, level));
            this.buildingService.placeTile(newRoof, level);
        });
    }

    calculateDepth(width: number, height: number, RoofType: string) {
        return calculateRoofDepth(width, height, RoofType);
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
