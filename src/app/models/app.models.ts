import { SafeResourceUrl } from "@angular/platform-browser";

//Web App Only
export interface SvgTile {
    name?: string;
    url: SafeResourceUrl;
    x: number;
    y: number;
}

export interface GridTile {
    x: number;
    y: number;
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
    used_tiles: string;
    used_furniture: string;

}

export interface TileEntry {
    category: string;
    tiles: Tile[];
}

export interface Tile {
    enum: string;
    tile: string;
}

export interface Furniture {
    layer: string;
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
}