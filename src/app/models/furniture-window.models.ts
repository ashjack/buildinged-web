import { SvgTile } from "./app.models";

//BuildingFurniture File
export interface BFurnitureGroup {
    label: string;
    furniture: BFurniture[];
}

export interface BFurniture {
    entries: BEntry[];
}

export interface BEntry {
    orient: string;
    items: BEntryItem[];
}

export interface BEntryItem {
    pos: string;
    tile: string;
}

//Misc
export interface VisualFurniture {
    entries: VisualFurnitureEntry[];
}

export interface VisualFurnitureEntry {
    orient: string;
    tiles: SvgTile[];
    xSize: number;
    ySize: number;
}