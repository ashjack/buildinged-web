import { SvgTile } from "./app.models";

//BuildingFurniture File
export interface BFurnitureGroup {
    label: string;
    furniture: BFurniture[];
}

export interface BFurniture {
    entries: BEntry[];
    layer?: string;
    corners?: boolean;
}

export interface BEntry {
    orient: string;
    grime?: boolean;
    items: BEntryItem[];
}

export interface BEntryItem {
    pos: string;
    tile: string;
}

//Misc
export interface VisualFurniture {
    entries: VisualFurnitureEntry[];
    layer?: string;
    corners?: boolean;
}

export interface VisualFurnitureEntry {
    orient: string;
    grime?: boolean;
    tiles: SvgTile[];
    xSize: number;
    ySize: number;
}
