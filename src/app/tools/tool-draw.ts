import { SvgTile } from "../models/app.models";
import { ViewportComponent } from "../viewport/viewport.component";
import Tool from "./tool";

export default abstract class ToolDraw extends Tool {

    dragTiles: SvgTile[] = [];
    beginDragCoords: number[] = [];
    isDragging: boolean = false;

    constructor() {
        super();
    }

    abstract hoverTile(x: number, y: number): void;

    abstract beginDrag(x: number, y: number): void;

    abstract endDrag(x: number, y: number): void;

    abstract clickTile(x: number, y: number): void;

    abstract getTileFill(x: number, y: number): string;
}