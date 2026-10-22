import { Point, SvgObject, SvgTile } from "../models/app.models";
import Tool from "./tool";

export default abstract class ToolDraw extends Tool {

    dragTiles: SvgTile[] = [];
    beginDragCoords: number[] = [];
    isDragging: boolean = false;
    tileGhosts: SvgTile[] = [];
    protected gestureLevel: number | undefined;
    modifiers = { ctrl: false, shift: false, alt: false };
    hoveredObject: SvgObject | undefined;
    pointerPosition: Point | undefined;
    overlays: { points: Point[]; fill: string; stroke: string; crossed?: boolean; label?: string }[] = [];
    previewTiles: SvgTile[] | undefined;
    cursor = 'default';
    reset(): void { this.cancel(); }
    deleteSelection(): boolean { return false; }
    keyDown(key: string): boolean { return false; }

    constructor() {
        super();
    }

    cancel(): void {
        this.isDragging = false;
        this.beginDragCoords = [];
        this.dragTiles = [];
        this.tileGhosts = [];
        this.overlays = [];
        this.previewTiles = undefined;
        this.gestureLevel = undefined;
    }

    protected startGesture(x: number, y: number, level: number): void {
        this.cancel();
        this.beginDragCoords = [x, y];
        this.gestureLevel = level;
        this.isDragging = true;
    }

    protected finishGesture(currentLevel: number): { x: number; y: number; level: number } | undefined {
        const start = this.isDragging && this.gestureLevel === currentLevel
            ? { x: this.beginDragCoords[0], y: this.beginDragCoords[1], level: currentLevel } : undefined;
        this.cancel();
        return start;
    }

    abstract hoverTile(x: number, y: number, closestEdge?: string, closestCorner?: string): void;

    abstract beginDrag(x: number, y: number): void;

    abstract endDrag(x: number, y: number): void;

    abstract clickTile(x: number, y: number): void;

    abstract getTileFill(x: number, y: number): string;
}
