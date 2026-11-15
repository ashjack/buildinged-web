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
import { ROOF_OPTIONS, buildRoofPlacements, calculateRoofDepth, defaultRoofCaps, getRoofOptionById } from "./roof-patterns";
import { generateBuildingSquares } from './native-squares';
import { resizeNativeRoof } from '../utils/native-roof';
import { validObject } from '../utils/selection-edits';
import { RoofToolGroup, ROOF_TOOL_GROUPS, roofToolGroup } from '../utils/roof-toolbar';
import { compoundRoofMaxWing, compoundRoofRotation, compoundRoofSlopeSpan, compoundRoofWings, isCompoundRoof } from './compound-roof';

export type RoofDimension = 'mainLength' | 'mainWidth' | 'returnLength' | 'returnWidth';
export interface RoofDimensions { mainLength: number; mainWidth: number; returnLength: number; returnWidth: number; }

@Injectable({
    providedIn: 'root',
})
export class RoofService {
    private shapeSettings = { RoofRotation: 0, RoofMirror: false, RoofWingWidth: 0, RoofMainWidth: 0, RoofReturnWidth: 0,
        RoofMainLength: 0, RoofReturnLength: 0 };
    constructor(private buildingService: BuildingService, private gridService: GridService, private store: Store<fromRoot.State>) {
        try { const saved = JSON.parse(localStorage.getItem('compoundRoofSettings') || '{}');
            const width = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(255, Math.floor(Number(value)))) : 0;
            this.shapeSettings = { RoofRotation: compoundRoofRotation(saved), RoofMirror: saved.RoofMirror === true,
                RoofWingWidth: width(saved.RoofWingWidth), RoofMainWidth: width(saved.RoofMainWidth ?? saved.RoofWingWidth),
                RoofReturnWidth: width(saved.RoofReturnWidth ?? saved.RoofWingWidth),
                RoofMainLength: Number.isFinite(Number(saved.RoofMainLength)) ? Math.max(0, Math.min(256, Math.floor(Number(saved.RoofMainLength)))) : 0,
                RoofReturnLength: Number.isFinite(Number(saved.RoofReturnLength)) ? Math.max(0, Math.min(256, Math.floor(Number(saved.RoofReturnLength)))) : 0 };
        } catch { /* Use default shape settings. */ }
    }

    roofOptions = ROOF_OPTIONS;
    message = '';
    editingRoofId?: string;
    drawing = false;
    get editingRoof(): any { return this.editingRoofId ? this.building?.floors[this.gridService.getSelectedLevel()]?.objects.find(o => o.uid === this.editingRoofId && isCompoundRoof(o.RoofType)) : undefined; }
    get compoundType(): string { return this.editingRoof?.RoofType || this.getSelectedRoofType(); }
    get compoundSettingsVisible(): boolean { return isCompoundRoof(this.compoundType); }
    get compoundUnequalWings(): boolean { return this.compoundType.startsWith('L'); }
    get compoundSlopeSpan(): number { return compoundRoofSlopeSpan(this.compoundType); }
    get compoundMaxWidth(): number { return compoundRoofMaxWing(this.compoundType); }
    get compoundDimensions(): RoofDimensions {
        const r = this.compoundRotation;
        const roof = this.editingRoof || resizeNativeRoof({ RoofType: this.compoundType, ...this.compoundSettings(this.compoundType) },
            (r % 2 ? this.shapeSettings.RoofReturnLength : this.shapeSettings.RoofMainLength) || 1,
            (r % 2 ? this.shapeSettings.RoofMainLength : this.shapeSettings.RoofReturnLength) || 1, false);
        const wings = compoundRoofWings({ ...roof, roofType: roof.RoofType });
        return { mainLength: Number(r % 2 ? roof.height : roof.width), returnLength: Number(r % 2 ? roof.width : roof.height),
            mainWidth: wings.main, returnWidth: wings.return };
    }
    configureDimension(key: RoofDimension, value: number): void {
        if (this.drawing || !Number.isFinite(value)) return;
        const dimensions = { ...this.compoundDimensions, [key]: Math.max(1, Math.min(key.endsWith('Width') ? this.compoundMaxWidth : 256, Math.floor(value))) };
        const minimumMain = dimensions.returnWidth + (this.compoundType.startsWith('T') ? 2 : 1);
        const minimumReturn = dimensions.mainWidth + 1;
        if (key.endsWith('Length') && (dimensions.mainLength < minimumMain || dimensions.returnLength < minimumReturn)) {
            this.message = `Main length must be at least ${minimumMain} tiles and return length at least ${minimumReturn} tiles to keep the wings joined with an open notch.`; return;
        }
        dimensions.mainLength = Math.max(dimensions.mainLength, minimumMain);
        dimensions.returnLength = Math.max(dimensions.returnLength, minimumReturn);
        const r = this.compoundRotation, roof = this.editingRoof;
        const width = r % 2 ? dimensions.returnLength : dimensions.mainLength;
        const height = r % 2 ? dimensions.mainLength : dimensions.returnLength;
        const changes = { RoofMainWidth: dimensions.mainWidth, RoofReturnWidth: dimensions.returnWidth, width, height, Depth: 'Zero' };
        if (roof) {
            if (!validObject(this.building, { ...roof, ...changes })) { this.message = 'These dimensions would extend outside the building. Move the roof or enlarge the building area first.'; return; }
            this.update(roof.uid, changes); this.editingRoofId = roof.uid;
        }
        this.shapeSettings = { ...this.shapeSettings, RoofMainWidth: dimensions.mainWidth, RoofReturnWidth: dimensions.returnWidth,
            RoofMainLength: dimensions.mainLength, RoofReturnLength: dimensions.returnLength };
        localStorage.setItem('compoundRoofSettings', JSON.stringify(this.shapeSettings)); this.message = '';
    }
    get compoundWingOptions(): number[] { return Array.from({ length: compoundRoofMaxWing(this.compoundType) }, (_, i) => i + 1); }
    get compoundWingWidth(): number { return Math.min(compoundRoofMaxWing(this.compoundType), Number(this.editingRoof?.RoofWingWidth ?? this.shapeSettings.RoofWingWidth) || 0); }
    compoundWidth(key: 'RoofMainWidth' | 'RoofReturnWidth'): number {
        const roof = this.editingRoof;
        return Math.min(compoundRoofMaxWing(this.compoundType), Number(roof ? roof[key] ?? roof.RoofWingWidth ?? 0 : this.shapeSettings[key]) || 0);
    }
    get compoundRotation(): number { return compoundRoofRotation(this.editingRoof || this.shapeSettings); }
    get compoundMirror(): boolean { const value = this.editingRoof?.RoofMirror ?? this.shapeSettings.RoofMirror; return value === true || value === 'true'; }
    get panelTitle(): string { return this.editingRoof ? `Edit ${this.roofOptions.find(o => o.roofType === this.editingRoof.RoofType)?.label || 'roof'}` : this.getSelectedRoofOption().label; }
    configureCompound(key: 'RoofRotation' | 'RoofMirror' | 'RoofWingWidth' | 'RoofMainWidth' | 'RoofReturnWidth', value: number | boolean): void {
        if (this.drawing) return;
        if (key === 'RoofRotation') value = compoundRoofRotation({ RoofRotation: Number(value) });
        if (['RoofWingWidth', 'RoofMainWidth', 'RoofReturnWidth'].includes(key)) {
            if (!Number.isFinite(Number(value))) return;
            value = Math.max(0, Math.min(compoundRoofMaxWing(this.compoundType), Math.floor(Number(value))));
        }
        const roof = this.editingRoof;
        if (roof) {
            const swap = key === 'RoofRotation' && Number(value) % 2 !== compoundRoofRotation(roof) % 2;
            const next = resizeNativeRoof({ ...roof, [key]: value }, Number(swap ? roof.height : roof.width), Number(swap ? roof.width : roof.height), false);
            if (!validObject(this.building, next)) { this.message = 'This shape would extend outside the building. Resize or move the roof first.'; return; }
            this.update(roof.uid, { [key]: value, width: next.width, height: next.height, Depth: next.Depth });
            // Document edits cancel pointer gestures; keep this roof selected for the next settings change.
            this.editingRoofId = roof.uid;
        }
        this.shapeSettings = { ...this.shapeSettings, [key]: value };
        localStorage.setItem('compoundRoofSettings', JSON.stringify(this.shapeSettings));
        this.message = '';
    }
    get building() { return this.buildingService.building; }
    private compoundSettings(type: string) {
        const { RoofMainWidth, RoofReturnWidth, RoofMainLength, RoofReturnLength, ...shared } = this.shapeSettings;
        return { ...shared, RoofWingWidth: Math.min(compoundRoofMaxWing(type), shared.RoofWingWidth),
            RoofMainWidth: Math.min(compoundRoofMaxWing(type), RoofMainWidth), RoofReturnWidth: Math.min(compoundRoofMaxWing(type), RoofReturnWidth) };
    }
    createObject(x: number, y: number, type: string): any {
        const tiles = this.getRoofTileEntries(this.building);
        const r = compoundRoofRotation(this.shapeSettings), compound = isCompoundRoof(type);
        return resizeNativeRoof({ uid: GUID.generateGUID(), type: 'roof', x, y, RoofType: type, Depth: 'Zero',
            ...(isCompoundRoof(type) ? this.compoundSettings(type) : {}),
            ...defaultRoofCaps(type), CapTiles: tiles.cap, SlopeTiles: tiles.slope, TopTiles: tiles.top },
            compound ? (r % 2 ? this.shapeSettings.RoofReturnLength : this.shapeSettings.RoofMainLength) || 1 : 1,
            compound ? (r % 2 ? this.shapeSettings.RoofMainLength : this.shapeSettings.RoofReturnLength) || 1 : 1, false);
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
        const option = ROOF_OPTIONS.find(o => o.id === optionId);
        if (!option) return;
        this.editingRoofId = undefined;
        localStorage.setItem('selectedRoofOptionId', optionId);
        localStorage.setItem('roofTool-' + roofToolGroup(option), optionId);
    }

    getGroupOption(group: RoofToolGroup) {
        const options = ROOF_TOOL_GROUPS.find(g => g.id === group)!.options;
        const current = this.getSelectedRoofOption();
        return roofToolGroup(current) === group ? current
            : options.find(o => o.id === localStorage.getItem('roofTool-' + group))
                || options.find(o => o.id === ({ standard: 'peak-vertical', shallow: 'shallow-peak-vertical', roof30: 'peak30-vertical', corners: 'corner-inner-nw', corners30: 'corner30-inner-nw' })[group])!;
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

            const shape = isCompoundRoof(RoofType) ? this.compoundSettings(RoofType) : {};
            const resized = resizeNativeRoof({ RoofType, ...shape }, width + 1, height + 1, false);
            const { width: roofWidth, height: roofHeight } = resized;
            if (!ROOF_OPTIONS.some(option => option.roofType === RoofType) || !canPlaceObject(b, x, y, level, roofWidth, roofHeight)) return;
            const depth = this.calculateDepth(roofWidth, roofHeight, RoofType);
            const tileEntries = this.getRoofTileEntries(b);

            const newRoof = {
                uid: GUID.generateGUID(),
                type: 'roof',
                width: roofWidth,
                height: roofHeight,
                RoofType: RoofType,
                ...shape,
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
            ...(isCompoundRoof(RoofType) ? this.shapeSettings : {}),
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
