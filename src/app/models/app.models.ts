import { SafeResourceUrl } from "@angular/platform-browser";

//Web App Only
export interface SvgTile {
    name?: string;
    url: SafeResourceUrl;
    x: number;
    y: number;
    layer: string;
    level: number;
    offsetX?: number;
    offsetY?: number;
    hidden?: boolean;
    excluded?: boolean;
    orient?: boolean;
    auto?: boolean;
}

export interface GridTile {
    x: number;
    y: number;
    level: number;
}

export interface GridRoom {
    name: string;
    tiles: GridTile[];
    placedTiles: SvgTile[];
    placedInteriorTiles: SvgTile[];
}

//Building File Specific
export interface Building {
    version: number;
    width: number;
    height: number;
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
    entries: TileEntry[];
    furniture: Furniture[];
    user_tiles: Tile[];
    used_tiles: string;
    used_furniture: string;
    rooms: Room[];
    floors: Floor[];
}

export interface TileEntry {
    category: string;
    tiles: Tile[];
}

export interface Tile {
    enum?: string;
    tile: string;
    offset?: string;
}

export interface Furniture {
    layer?: string;
    entries: FurnitureTileEntry[];
}

export interface FurnitureTileEntry {
    orient: string;
    tiles: FurnitureTile[];
}

export interface FurnitureTile {
    x: number;
    y: number;
    name: string;
}

export interface Room {
    Name: string;
    InternalName: string;
    Color: string;
    InteriorWall: number;
    InteriorWallTrim: number;
    Floor: number;
    GrimeFloor: number;
    GrimeWall: number;
}

export interface Floor {
    objects: any[];
    rooms: string;
    tileLayers?: FloorTiles[];
}

export interface FloorTiles {
    layer: string;
    tiles: string;
}