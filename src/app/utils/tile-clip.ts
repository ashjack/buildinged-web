/** Polygons in normalized sprite coordinates, shared by the editor and lot previews. */
export type TileClip = { x: number; y: number }[][];

export function applyTileClip(context: CanvasRenderingContext2D, polygons: TileClip | undefined,
    x: number, y: number, width: number, height: number): void {
    if (!polygons?.length) return;
    context.beginPath();
    for (const polygon of polygons) {
        polygon.forEach((p, i) => i ? context.lineTo(x + p.x * width, y + p.y * height)
            : context.moveTo(x + p.x * width, y + p.y * height));
        context.closePath();
    }
    context.clip();
}
