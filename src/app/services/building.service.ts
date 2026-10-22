import { Injectable } from "@angular/core";
import { Building, Furniture, FurnitureTileEntry, Tile, TileEntry } from "../models/app.models";
import { DbService } from "./db.service";
import { TileService } from "./tile.service";
import { GridService } from "./grid.service";
import { RoomService } from "./room.service";
import { Store } from "@ngrx/store";
import * as fromRoot from '../app.reducers';
import { ScheduleRedraw, SetBuilding } from "../app.actions";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom, take } from "rxjs";
import { readBuildingFile, writeBuildingFile, TBX_VERSION } from "../utils/tbx-format";
import { emptyIndexGrid, readIndexGrid, writeIndexGrid } from "../utils/tbx-grid";
import { generateBuildingSquares } from "./native-squares";

interface BuildingTemplateRoom {
    Name: string;
    InternalName: string;
    Color: string;
    InteriorWall: number;
    InteriorWallTrim: number;
    Floor: number;
    GrimeFloor: number;
    GrimeWall: number;
}

interface BuildingTemplateDefinition {
    Name: string;
    ExteriorWall: number;
    ExteriorWallTrim: number;
    Door: number;
    DoorFrame: number;
    Window: number;
    Curtains: number;
    Shutters: number;
    Stairs: number;
    RoofCap: number;
    RoofSlope: number;
    RoofTop: number;
    GrimeWall: number;
    UsedTiles: string;
    UsedFurniture: string;
    Rooms: BuildingTemplateRoom[];
}

interface TemplateCatalog {
    entries: TileEntry[];
    furniture: Furniture[];
    templates: BuildingTemplateDefinition[];
}

@Injectable({
    providedIn: 'root',
  })
export class BuildingService {
    // A read-through view of the NgRx document, never a second mutable building.
    get building(): Building {
        let building: Building | undefined;
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(value => building = value);
        return building!;
    }
    private templateCatalog: TemplateCatalog | null = null;
    private templateCatalogPromise: Promise<TemplateCatalog> | null = null;

    constructor(
        private db: DbService, 
        private tileService: TileService, 
        private gridService: GridService,
        private roomService: RoomService,
        private store: Store<fromRoot.State>,
        private http: HttpClient,) { }

    getBuilding(): Building {
        return this.building;
    }

    async getTemplateNames(): Promise<string[]> {
        const catalog = await this.ensureTemplateCatalogLoaded();
        return catalog.templates.map(t => t.Name);
    }

    async getDefaultTileEntries(): Promise<TileEntry[]> {
        const catalog = await this.ensureTemplateCatalogLoaded();
        return catalog.entries.map(entry => ({ ...entry, tiles: entry.tiles.map(tile => ({ ...tile })) }));
    }

    private async ensureTemplateCatalogLoaded(): Promise<TemplateCatalog> {
        if (this.templateCatalog) {
            return this.templateCatalog;
        }

        if (this.templateCatalogPromise) {
            return this.templateCatalogPromise;
        }

        this.templateCatalogPromise = (async () => {
            const fileText = await firstValueFrom(this.http.get('assets/BuildingTemplates.txt', { responseType: 'text' }));
            const parsed = this.parseTemplateCatalog(fileText);
            this.templateCatalog = parsed;
            this.templateCatalogPromise = null;
            return parsed;
        })();

        return this.templateCatalogPromise;
    }

    private parseTemplateCatalog(fileText: string): TemplateCatalog {
        const tileEntryBlocks = this.extractNamedBlocks(fileText, 'TileEntry');
        const furnitureBlocks = this.extractNamedBlocks(fileText, 'furniture');
        const templateBlocks = this.extractNamedBlocks(fileText, 'Template');

        const entries = tileEntryBlocks.map(block => this.parseTileEntryBlock(block.content));
        const furniture = furnitureBlocks.map(block => this.parseFurnitureBlock(block.content));
        const templates = templateBlocks.map(block => this.parseTemplateBlock(block.content));

        return { entries, furniture, templates };
    }

    private extractNamedBlocks(source: string, keyword: string): { start: number; end: number; content: string }[] {
        const results: { start: number; end: number; content: string }[] = [];
        const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'g');

        let match: RegExpExecArray | null;
        while ((match = keywordRegex.exec(source)) !== null) {
            const keywordIndex = match.index;
            const openBraceIndex = source.indexOf('{', keywordIndex);
            if (openBraceIndex === -1) {
                continue;
            }

            let depth = 0;
            let closeBraceIndex = -1;
            for (let i = openBraceIndex; i < source.length; i++) {
                const ch = source[i];
                if (ch === '{') {
                    depth++;
                } else if (ch === '}') {
                    depth--;
                    if (depth === 0) {
                        closeBraceIndex = i;
                        break;
                    }
                }
            }

            if (closeBraceIndex === -1) {
                continue;
            }

            results.push({
                start: keywordIndex,
                end: closeBraceIndex + 1,
                content: source.slice(openBraceIndex + 1, closeBraceIndex),
            });

            keywordRegex.lastIndex = closeBraceIndex + 1;
        }

        return results;
    }

    private parseKeyValue(line: string): { key: string; value: string } | null {
        const eqIndex = line.indexOf('=');
        if (eqIndex === -1) {
            return null;
        }

        return {
            key: line.slice(0, eqIndex).trim(),
            value: line.slice(eqIndex + 1).trim(),
        };
    }

    private parseTileEntryBlock(block: string): TileEntry {
        const lines = block.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        let category = '';
        const tiles: Tile[] = [];
        const offsets = new Map<string, string>();

        lines.forEach(line => {
            const parsed = this.parseKeyValue(line);
            if (!parsed) {
                return;
            }

            if (parsed.key === 'category') {
                category = parsed.value;
                return;
            }

            if (parsed.key === 'offset') {
                const [name, x, y] = parsed.value.split(/\s+/);
                if (name && /^-?\d+$/.test(x) && /^-?\d+$/.test(y)) offsets.set(name, `${x} ${y}`);
                return;
            }

            tiles.push({
                enum: parsed.key,
                tile: parsed.value,
            });
        });

        tiles.forEach(tile => {
            if (offsets.has(tile.enum!)) tile.offset = offsets.get(tile.enum!);
        });

        return {
            category,
            tiles,
        };
    }

    private parseFurnitureEntryBlock(block: string): FurnitureTileEntry {
        const lines = block.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        let orient = 'W';
        let grime: boolean | undefined;
        const tiles: { x: number; y: number; name: string }[] = [];

        lines.forEach(line => {
            const parsed = this.parseKeyValue(line);
            if (!parsed) {
                return;
            }

            if (parsed.key === 'orient') {
                orient = parsed.value;
                return;
            }
            if (parsed.key === 'grime') {
                grime = parsed.value !== 'false';
                return;
            }

            const coords = parsed.key.split(',').map(x => Number.parseInt(x.trim(), 10));
            if (coords.length !== 2 || Number.isNaN(coords[0]) || Number.isNaN(coords[1])) {
                return;
            }

            if (!parsed.value) {
                return;
            }

            tiles.push({
                x: coords[0],
                y: coords[1],
                name: parsed.value,
            });
        });

        return {
            orient,
            grime,
            tiles,
        };
    }

    private parseFurnitureBlock(block: string): Furniture {
        const entries = this.extractNamedBlocks(block, 'entry').map(entry => this.parseFurnitureEntryBlock(entry.content));

        const topLevelLines = block.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        let layer: string | undefined = undefined;
        let corners: boolean | undefined;
        let depth = 0;

        for (const line of topLevelLines) {
            if (line.includes('{')) {
                depth++;
                continue;
            }
            if (line.includes('}')) {
                depth = Math.max(0, depth - 1);
                continue;
            }
            if (depth > 0) {
                continue;
            }

            const parsed = this.parseKeyValue(line);
            if (!parsed) {
                continue;
            }

            if (parsed.key === 'layer' && parsed.value) {
                layer = parsed.value;
            }
            if (parsed.key === 'corners') corners = parsed.value === 'true';
        }

        return {
            layer,
            corners,
            entries,
        };
    }

    private parseTemplateRoomBlock(block: string): BuildingTemplateRoom {
        const room: BuildingTemplateRoom = {
            Name: '',
            InternalName: '',
            Color: '255 255 255',
            InteriorWall: 0,
            InteriorWallTrim: 0,
            Floor: 0,
            GrimeFloor: 0,
            GrimeWall: 0,
        };

        block.split(/\r?\n/).map(line => line.trim()).forEach(line => {
            const parsed = this.parseKeyValue(line);
            if (!parsed) {
                return;
            }

            switch (parsed.key) {
                case 'Name':
                    room.Name = parsed.value;
                    break;
                case 'InternalName':
                    room.InternalName = parsed.value;
                    break;
                case 'Color':
                    room.Color = parsed.value;
                    break;
                case 'InteriorWall':
                    room.InteriorWall = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'InteriorWallTrim':
                    room.InteriorWallTrim = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'Floor':
                    room.Floor = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'GrimeFloor':
                    room.GrimeFloor = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'GrimeWall':
                    room.GrimeWall = Number.parseInt(parsed.value, 10) || 0;
                    break;
            }
        });

        return room;
    }

    private parseTemplateBlock(block: string): BuildingTemplateDefinition {
        const roomBlocks = this.extractNamedBlocks(block, 'Room');
        const rooms = roomBlocks.map(roomBlock => this.parseTemplateRoomBlock(roomBlock.content));

        const template: BuildingTemplateDefinition = {
            Name: 'New Building',
            ExteriorWall: 0,
            ExteriorWallTrim: 0,
            Door: 0,
            DoorFrame: 0,
            Window: 0,
            Curtains: 0,
            Shutters: 0,
            Stairs: 0,
            RoofCap: 0,
            RoofSlope: 0,
            RoofTop: 0,
            GrimeWall: 0,
            UsedTiles: '',
            UsedFurniture: '',
            Rooms: rooms,
        };

        let depth = 0;
        block.split(/\r?\n/).map(line => line.trim()).forEach(line => {
            if (line.includes('{')) {
                depth++;
                return;
            }
            if (line.includes('}')) {
                depth = Math.max(0, depth - 1);
                return;
            }

            if (depth > 0) {
                return;
            }

            const parsed = this.parseKeyValue(line);
            if (!parsed) {
                return;
            }

            switch (parsed.key) {
                case 'Name':
                    template.Name = parsed.value;
                    break;
                case 'ExteriorWall':
                    template.ExteriorWall = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'ExteriorWallTrim':
                    template.ExteriorWallTrim = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'Door':
                    template.Door = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'DoorFrame':
                    template.DoorFrame = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'Window':
                    template.Window = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'Curtains':
                    template.Curtains = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'Shutters':
                    template.Shutters = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'Stairs':
                    template.Stairs = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'RoofCap':
                    template.RoofCap = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'RoofSlope':
                    template.RoofSlope = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'RoofTop':
                    template.RoofTop = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'GrimeWall':
                    template.GrimeWall = Number.parseInt(parsed.value, 10) || 0;
                    break;
                case 'UsedTiles':
                    template.UsedTiles = parsed.value;
                    break;
                case 'UsedFurniture':
                    template.UsedFurniture = parsed.value;
                    break;
            }
        });

        return template;
    }

    private cloneRoom(room: BuildingTemplateRoom) {
        return {
            Name: room.Name,
            InternalName: room.InternalName,
            Color: room.Color,
            InteriorWall: room.InteriorWall,
            InteriorWallTrim: room.InteriorWallTrim,
            Floor: room.Floor,
            GrimeFloor: room.GrimeFloor,
            GrimeWall: room.GrimeWall,
        };
    }

    private createEmptyRoomsMatrix(width: number, height: number): string {
        return writeIndexGrid(emptyIndexGrid(width, height));
    }

    async createBuildingFromXml(xmlDoc: Document): Promise<void> {
        const building = readBuildingFile(xmlDoc);
        this.store.dispatch(new SetBuilding(building));
    }

    cacheBuilding(building: Building): void {
        try {
            localStorage.setItem('buildingXml', new XMLSerializer().serializeToString(writeBuildingFile(building)));
        } catch (error) {
            console.warn('Could not cache the building document.', error);
        }
    }

    async saveBuildingToXml(): Promise<XMLDocument | undefined> {
        const building = await firstValueFrom(this.store.select(fromRoot.getBuilding).pipe(take(1)));
        if (!building) return undefined;
        const xml = writeBuildingFile(building);
        const xmlString = '<?xml version="1.0" encoding="UTF-8"?>' + new XMLSerializer().serializeToString(xml);
        const url = URL.createObjectURL(new Blob([xmlString], { type: 'text/xml' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'building.tbx';
        link.style.display = 'none';
        document.body.appendChild(link);
        try {
            link.click();
            localStorage.setItem('buildingXml', xmlString);
        } finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        return xml;
    }

    async createNewBuilding(templateName?: string) {
        let template: BuildingTemplateDefinition | undefined = undefined;
        let catalog: TemplateCatalog | undefined = undefined;

        try {
            catalog = await this.ensureTemplateCatalogLoaded();
            if (templateName) {
                template = catalog.templates.find(t => t.Name === templateName);
            }
        } catch (error) {
            console.error('Failed to load template catalog.', error);
        }

        const rooms = template ? template.Rooms.map(room => this.cloneRoom(room)) : [];
        const width = 20;
        const height = 20;
        const floors = [{
            objects: [],
            rooms: this.createEmptyRoomsMatrix(width, height),
            tileLayers: [],
        }];

        const newBuilding: Building = {
            version: TBX_VERSION,
            properties: {},
            width,
            height,
            ExteriorWall: template?.ExteriorWall ?? 0,
            ExteriorWallTrim: template?.ExteriorWallTrim ?? 0,
            Door: template?.Door ?? 0,
            DoorFrame: template?.DoorFrame ?? 0,
            Window: template?.Window ?? 0,
            Curtains: template?.Curtains ?? 0,
            Shutters: template?.Shutters ?? 0,
            Stairs: template?.Stairs ?? 0,
            RoofCap: template?.RoofCap ?? 0,
            RoofSlope: template?.RoofSlope ?? 0,
            RoofTop: template?.RoofTop ?? 0,
            GrimeWall: template?.GrimeWall ?? 0,
            rooms,
            entries: catalog ? catalog.entries.map(entry => ({
                category: entry.category,
                tiles: entry.tiles.map(tile => ({
                    enum: tile.enum,
                    tile: tile.tile,
                    offset: tile.offset,
                }))
            })) : [],
            furniture: catalog ? catalog.furniture.map(item => ({
                layer: item.layer,
                corners: item.corners,
                entries: item.entries.map(entry => ({
                    orient: entry.orient,
                    grime: entry.grime,
                    tiles: entry.tiles.map(tile => ({
                        x: tile.x,
                        y: tile.y,
                        name: tile.name,
                    }))
                }))
            })) : [],
            user_tiles: [],
            // Templates use one-based furniture IDs; TBX files use zero-based IDs.
            used_furniture: template?.UsedFurniture.trim()
                ? template.UsedFurniture.trim().split(/\s+/).map(index => Number(index) - 1).join(' ') : '',
            used_tiles: template?.UsedTiles ?? '',
            floors
        }

        this.store.dispatch(new SetBuilding(newBuilding));
    }

    renderBuilding(building: Building, resetView = false, historyFloor?: number): void {
        if (resetView) {
            this.gridService.setSelectedLevel(0);
            this.roomService.selectedRoomIndex = 0;
        }
        if (historyFloor !== undefined) this.gridService.setSelectedLevel(historyFloor);
        this.gridService.beginRebuild();
        try {
            this.roomService.rebuild(building);
            building.floors.forEach((floor, level) => {
                floor.tileLayers?.forEach(layer => {
                    readIndexGrid(layer.tiles, building.width + 1, building.height + 1).forEach((row, y) => row.forEach((index, x) => {
                        if (!index) return;
                        const name = building.user_tiles[index - 1].tile + '.png';
                        this.gridService.placeTile2({ name, url: name, x, y, layer: layer.layer, level }, false);
                    }));
                });
            });
            const generated = generateBuildingSquares(building);
            this.gridService.roomTiles = generated.tiles;
            generated.objects.forEach(object => this.gridService.addObject(object));
        } finally {
            this.gridService.endRebuild();
        }
    }

    getEntry(id: number): TileEntry
    {
        return this.building.entries[id - 1];
    }

    public getFullDir(dir: string): string
    {
        switch(dir)
        {
            case 'N':
                return 'North';
            case 'S':
                return 'South';
            case 'E':
                return 'East';
            case 'W':
                return 'West';
            case 'NE':
                return 'NorthEast';
            case 'NW':
                return 'NorthWest';
            case 'SE':
                return 'SouthEast';
            case 'SW':
                return 'SouthWest';
            default:
                return '';
        }
    }
}
