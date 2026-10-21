import { SvgTile } from "../models/app.models";

export interface RoofTileSource { enum?: string; tile: string; offset?: string; }
export interface RoofTileSet { capTiles: RoofTileSource[]; slopeTiles: RoofTileSource[]; topTiles: RoofTileSource[]; }
export interface RoofPlacementOptions {
    x: number; y: number; level: number; width: number; height: number; roofType: string; tileset: RoofTileSet;
    hasRoofTile?: (x: number, y: number, level: number) => boolean;
    isManualRoofTile?: (x: number, y: number, level: number) => boolean;
    hasRoofCapTile?: (x: number, y: number, level: number) => boolean;
    isManualRoofCapTile?: (x: number, y: number, level: number) => boolean;
    cappedW?: boolean; cappedN?: boolean; cappedE?: boolean; cappedS?: boolean;
    hasFloorTile?: (x: number, y: number, level: number) => boolean;
    isManualFloorTile?: (x: number, y: number, level: number) => boolean;
}
export interface RoofOption { id: string; label: string; roofType: string; group: string; }

export const ROOF_OPTIONS: RoofOption[] = [
    { id: "slope-w", label: "Slope (W)", roofType: "SlopeW", group: "Standard" },
    { id: "slope-n", label: "Slope (N)", roofType: "SlopeN", group: "Standard" },
    { id: "slope-e", label: "Slope (E)", roofType: "SlopeE", group: "Standard" },
    { id: "slope-s", label: "Slope (S)", roofType: "SlopeS", group: "Standard" },
    { id: "peak-horizontal", label: "Peak (Horizontal)", roofType: "PeakWE", group: "Standard" },
    { id: "peak-vertical", label: "Peak (Vertical)", roofType: "PeakNS", group: "Standard" },
    { id: "dormer-w", label: "Dormer (W)", roofType: "DormerW", group: "Dormers" },
    { id: "dormer-n", label: "Dormer (N)", roofType: "DormerN", group: "Dormers" },
    { id: "dormer-e", label: "Dormer (E)", roofType: "DormerE", group: "Dormers" },
    { id: "dormer-s", label: "Dormer (S)", roofType: "DormerS", group: "Dormers" },
    { id: "flat-top", label: "Flat Top", roofType: "FlatTop", group: "Flat" },
    { id: "shallow-slope-w", label: "Shallow Slope (W)", roofType: "ShallowSlopeW", group: "Shallow" },
    { id: "shallow-slope-n", label: "Shallow Slope (N)", roofType: "ShallowSlopeN", group: "Shallow" },
    { id: "shallow-slope-e", label: "Shallow Slope (E)", roofType: "ShallowSlopeE", group: "Shallow" },
    { id: "shallow-slope-s", label: "Shallow Slope (S)", roofType: "ShallowSlopeS", group: "Shallow" },
    { id: "shallow-peak-horizontal", label: "Shallow Peak (Horizontal)", roofType: "ShallowPeakWE", group: "Shallow" },
    { id: "shallow-peak-vertical", label: "Shallow Peak (Vertical)", roofType: "ShallowPeakNS", group: "Shallow" },
    { id: "corner-inner-sw", label: "Corner Inner (SW)", roofType: "CornerInnerSW", group: "Corners" },
    { id: "corner-inner-nw", label: "Corner Inner (NW)", roofType: "CornerInnerNW", group: "Corners" },
    { id: "corner-inner-ne", label: "Corner Inner (NE)", roofType: "CornerInnerNE", group: "Corners" },
    { id: "corner-inner-se", label: "Corner Inner (SE)", roofType: "CornerInnerSE", group: "Corners" },
    { id: "corner-outer-sw", label: "Corner Outer (SW)", roofType: "CornerOuterSW", group: "Corners" },
    { id: "corner-outer-nw", label: "Corner Outer (NW)", roofType: "CornerOuterNW", group: "Corners" },
    { id: "corner-outer-ne", label: "Corner Outer (NE)", roofType: "CornerOuterNE", group: "Corners" },
    { id: "corner-outer-se", label: "Corner Outer (SE)", roofType: "CornerOuterSE", group: "Corners" },
];

type Depth = "Zero" | "Point5" | "One" | "OnePoint5" | "Two" | "TwoPoint5" | "Three";
interface Rect { x: number; y: number; width: number; height: number; }
interface Matrix { rect: Rect; enums: (string | null)[]; tag?: string; }

export function getDefaultRoofOption(): RoofOption { return ROOF_OPTIONS.find(o => o.roofType === "PeakNS")!; }
export function getRoofOptionById(id: string): RoofOption { return ROOF_OPTIONS.find(o => o.id === id) || getDefaultRoofOption(); }

export function normalizeRoofSize(width: number, height: number, type: string): { width: number; height: number } {
    if (["SlopeW", "SlopeE"].includes(type)) width = clamp(width, 1, 3);
    if (["SlopeN", "SlopeS"].includes(type)) height = clamp(height, 1, 3);
    if (["ShallowSlopeW", "ShallowSlopeE"].includes(type)) width = clamp(width, 1, 2);
    if (["ShallowSlopeN", "ShallowSlopeS"].includes(type)) height = clamp(height, 1, 2);
    if (type === "ShallowPeakNS") width = width < 4 ? 2 : 4;
    if (type === "ShallowPeakWE") height = height < 4 ? 2 : 4;
    if (type.startsWith("Corner")) width = height = clamp(Math.max(width, height), 1, 3);
    return { width, height };
}

export function calculateRoofDepth(width: number, height: number, type: string): Depth {
    if (type === "FlatTop" || type.startsWith("Shallow")) return "Zero";
    if (type.startsWith("Corner")) return integerDepth(Math.max(width, height));
    if (["SlopeW", "SlopeE"].includes(type)) return integerDepth(width);
    if (["SlopeN", "SlopeS"].includes(type)) return integerDepth(height);
    const length = ["PeakNS", "DormerN", "DormerS"].includes(type) ? width : height;
    return peakDepth(length);
}

export function buildRoofPlacements(input: RoofPlacementOptions): SvgTile[] {
    const options = { ...input, ...normalizeRoofSize(input.width, input.height, input.roofType) };
    const output: SvgTile[] = [];
    const depth = calculateRoofDepth(options.width, options.height, options.roofType);
    const add = (source: RoofTileSource | undefined, x: number, y: number, layer: string, floor = false, tag?: string) => {
        if (!source) return;
        const [offsetX, offsetY] = parseOffset(source.offset);
        const cap = layer === "RoofCap";
        const occupied = floor ? options.hasFloorTile?.(x, y, options.level) : cap
            ? options.hasRoofCapTile?.(x, y, options.level) : options.hasRoofTile?.(x, y, options.level);
        const manual = floor ? options.isManualFloorTile?.(x, y, options.level) : cap
            ? options.isManualRoofCapTile?.(x, y, options.level) : options.isManualRoofTile?.(x, y, options.level);
        output.push({ name: source.tile + ".png", url: source.tile + ".png", x, y, offsetX, offsetY,
            layer: occupied && !manual ? (floor ? "FloorOverlay" : cap ? "RoofCap2" : "Roof2") : layer,
            level: options.level, tag });
    };
    const place = (matrix: Matrix | undefined, tiles: RoofTileSource[], layer: string, floor = false) => {
        if (!matrix) return;
        matrix.enums.forEach((name, index) => {
            if (!name) return;
            add(find(tiles, name), matrix.rect.x + index % matrix.rect.width,
                matrix.rect.y + Math.floor(index / matrix.rect.width), layer, floor, matrix.tag);
        });
    };

    place(slopeMatrix(options, depth), options.tileset.slopeTiles, "Roof");
    for (const cap of capMatrices(options, depth)) place(cap, options.tileset.capTiles, "RoofCap");
    place(cornerMatrix(options, depth), options.tileset.slopeTiles, "Roof");
    place(topMatrix(options, depth), options.tileset.topTiles, "Floor", true);
    return output;
}

function slopeMatrix(o: RoofPlacementOptions, depth: Depth): Matrix | undefined {
    const t = o.roofType, thick = slopeThickness(o), ep = eastPattern(depth), sp = southPattern(depth);
    let rect: Rect | undefined, pattern: string[] = [];
    if (t === "SlopeE") { rect = bounds(o); pattern = ep; }
    else if (t === "SlopeS") { rect = bounds(o); pattern = sp; }
    else if (t === "PeakWE") { rect = { x: o.x, y: o.y + o.height - thick, width: o.width, height: thick }; pattern = sp; }
    else if (t === "PeakNS") { rect = { x: o.x + o.width - thick, y: o.y, width: thick, height: o.height }; pattern = ep; }
    else if (t === "DormerW") { rect = { x: o.x, y: o.y + o.height - thick, width: o.width - thick, height: thick }; pattern = sp; }
    else if (t === "DormerE") { rect = { x: o.x + thick, y: o.y + o.height - thick, width: o.width - thick, height: thick }; pattern = sp; }
    else if (t === "DormerN") { rect = { x: o.x + o.width - thick, y: o.y, width: thick, height: o.height - thick }; pattern = ep; }
    else if (t === "DormerS") { rect = { x: o.x + o.width - thick, y: o.y + thick, width: thick, height: o.height - thick }; pattern = ep; }
    else if (t === "ShallowSlopeW") { rect = bounds(o); pattern = ["ShallowSlopeW1", ...(o.width > 1 ? ["ShallowSlopeW2"] : [])]; }
    else if (t === "ShallowSlopeE") { rect = bounds(o); pattern = [...(o.width > 1 ? ["ShallowSlopeE2"] : []), "ShallowSlopeE1"]; }
    else if (t === "ShallowPeakNS") { rect = bounds(o); pattern = ["ShallowSlopeW1", ...(o.width > 2 ? ["ShallowSlopeW2", "ShallowSlopeE2"] : []), "ShallowSlopeE1"]; }
    else if (t === "ShallowSlopeN") { rect = bounds(o); pattern = ["ShallowSlopeN1", ...(o.height > 1 ? ["ShallowSlopeN2"] : [])]; }
    else if (t === "ShallowSlopeS") { rect = bounds(o); pattern = [...(o.height > 1 ? ["ShallowSlopeS2"] : []), "ShallowSlopeS1"]; }
    else if (t === "ShallowPeakWE") { rect = bounds(o); pattern = ["ShallowSlopeN1", ...(o.height > 2 ? ["ShallowSlopeN2", "ShallowSlopeS2"] : []), "ShallowSlopeS1"]; }
    if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
    const enums: string[] = [];
    if (["SlopeE", "PeakNS", "DormerN", "DormerS", "ShallowSlopeW", "ShallowSlopeE", "ShallowPeakNS"].includes(t)) {
        for (let row = 0; row < rect.height; row++) enums.push(...pattern);
    } else if (["SlopeS", "PeakWE", "DormerW", "DormerE", "ShallowSlopeN", "ShallowSlopeS", "ShallowPeakWE"].includes(t)) {
        for (const tile of pattern) for (let column = 0; column < rect.width; column++) enums.push(tile);
    }
    return { rect, enums };
}

function capMatrices(o: RoofPlacementOptions, depth: Depth): Matrix[] {
    const t = o.roofType, result: Matrix[] = [];
    const enabled = (side: "W" | "N" | "E" | "S") => o[`capped${side}`] !== false;
    const edge = (side: "W" | "N" | "E" | "S", rect: Rect, enums: string[]) => {
        if (enums.length && enabled(side)) result.push({ rect, enums, tag: `capped${side}` });
    };
    const fullE = capPeak(depth, "E", o.height), fullS = capPeak(depth, "S", o.width);
    if (["PeakWE", "DormerW"].includes(t)) edge("W", { x: o.x, y: o.y, width: 1, height: o.height }, fullE);
    if (["PeakWE", "DormerE"].includes(t)) edge("E", { x: o.x + o.width, y: o.y, width: 1, height: o.height }, fullE);
    if (["PeakNS", "DormerN"].includes(t)) edge("N", { x: o.x, y: o.y, width: o.width, height: 1 }, fullS);
    if (["PeakNS", "DormerS"].includes(t)) edge("S", { x: o.x, y: o.y + o.height, width: o.width, height: 1 }, fullS);

    if (t === "SlopeW") {
        const p = capSide(depth, "S", "Rise"); edge("N", { x: o.x, y: o.y, width: p.length, height: 1 }, p);
        edge("S", { x: o.x, y: o.y + o.height, width: p.length, height: 1 }, p);
    } else if (t === "SlopeE") {
        const p = capSide(depth, "S", "Fall"); edge("N", { x: o.x + o.width - p.length, y: o.y, width: p.length, height: 1 }, p);
        edge("S", { x: o.x + o.width - p.length, y: o.y + o.height, width: p.length, height: 1 }, p);
    } else if (t === "SlopeN") {
        const p = capSide(depth, "E", "Fall"); edge("W", { x: o.x, y: o.y, width: 1, height: p.length }, p);
        edge("E", { x: o.x + o.width, y: o.y, width: 1, height: p.length }, p);
    } else if (t === "SlopeS") {
        const p = capSide(depth, "E", "Rise"); edge("W", { x: o.x, y: o.y + o.height - p.length, width: 1, height: p.length }, p);
        edge("E", { x: o.x + o.width, y: o.y + o.height - p.length, width: 1, height: p.length }, p);
    }

    const shallowNS = t === "ShallowPeakNS" ? shallowPeak("S", o.width) :
        t === "ShallowSlopeW" ? shallowSide("S", "Rise", o.width) : t === "ShallowSlopeE" ? shallowSide("S", "Fall", o.width) : [];
    if (shallowNS.length) {
        edge("N", { x: o.x, y: o.y, width: shallowNS.length, height: 1 }, shallowNS);
        edge("S", { x: o.x, y: o.y + o.height, width: shallowNS.length, height: 1 }, shallowNS);
    }
    const shallowWE = t === "ShallowPeakWE" ? shallowPeak("E", o.height) :
        t === "ShallowSlopeN" ? shallowSide("E", "Fall", o.height) : t === "ShallowSlopeS" ? shallowSide("E", "Rise", o.height) : [];
    if (shallowWE.length) {
        edge("W", { x: o.x, y: o.y, width: 1, height: shallowWE.length }, shallowWE);
        edge("E", { x: o.x + o.width, y: o.y, width: 1, height: shallowWE.length }, shallowWE);
    }
    return result;
}

function cornerMatrix(o: RoofPlacementOptions, depth: Depth): Matrix | undefined {
    const t = o.roofType, n = depthBands(depth), N: null = null;
    if (t === "DormerE") {
        const size = slopeThickness(o);
        const enums = n === 1 ? [inner(depth)] : n === 2
            ? [inner(depth), southAt(depth), N, "Inner1"]
            : [inner(depth), southAt(depth), southAt(depth), N, "Inner2", "SlopeS2", N, N, "Inner1"];
        return { rect: { x: o.x, y: o.y + o.height - size, width: size, height: size }, enums };
    }
    if (t === "DormerS") {
        const size = slopeThickness(o);
        const enums = n === 1 ? [inner(depth)] : n === 2
            ? [inner(depth), N, eastAt(depth), "Inner1"]
            : [inner(depth), N, N, eastAt(depth), "Inner2", N, eastAt(depth), "SlopeE2", "Inner1"];
        return { rect: { x: o.x + o.width - size, y: o.y, width: size, height: size }, enums };
    }
    const matrices: Record<string, Record<number, (string | null)[]>> = {
        CornerInnerNW: {
            1: [inner(depth)],
            2: [inner(depth), southAt(depth), eastAt(depth), "Inner1"],
            3: [inner(depth), southAt(depth), southAt(depth), eastAt(depth), "Inner2", "SlopeS2", eastAt(depth), "SlopeE2", "Inner1"],
        },
        CornerOuterSE: {
            1: [outer(depth)],
            2: [outer(depth), "SlopeE1", "SlopeS1", "Outer1"],
            3: [outer(depth), "SlopeE2", "SlopeE1", "SlopeS2", "Outer2", "SlopeE1", "SlopeS1", "SlopeS1", "Outer1"],
        },
        CornerOuterSW: {
            1: ["CornerSW1"],
            2: [N, "CornerSW2", "CornerSW1", "SlopeS1"],
            3: [N, N, "CornerSW3", N, "CornerSW2", "SlopeS2", "CornerSW1", "SlopeS1", "SlopeS1"],
        },
        CornerOuterNE: {
            1: ["CornerNE1"],
            2: [N, "CornerNE1", "CornerNE2", "SlopeE1"],
            3: [N, N, "CornerNE1", N, "CornerNE2", "SlopeE1", "CornerNE3", "SlopeE2", "SlopeE1"],
        },
    };
    const enums = matrices[t]?.[n];
    if (!enums) return undefined; // Other orientations expose cap faces only in TileZed's isometric view.
    return { rect: bounds(o), enums };
}

function topMatrix(o: RoofPlacementOptions, depth: Depth): Matrix | undefined {
    let rect: Rect | undefined;
    if (o.roofType === "FlatTop") rect = bounds(o);
    else if (["PeakWE", "DormerW", "DormerE"].includes(o.roofType) && o.height > 6)
        rect = { x: o.x, y: o.y + 3, width: o.width, height: o.height - 6 };
    else if (["PeakNS", "DormerN", "DormerS"].includes(o.roofType) && o.width > 6)
        rect = { x: o.x + 3, y: o.y, width: o.width - 6, height: o.height };
    if (!rect) return undefined;
    const name = depth === "One" ? "West1" : depth === "Two" ? "West2" : "West3";
    return { rect, enums: Array(rect.width * rect.height).fill(name) };
}

function capPeak(depth: Depth, axis: "E" | "S", length: number): string[] {
    if (depth === "Point5") return [`PeakPt5${axis}`];
    if (depth === "One") return [`Cap${axis === "E" ? "Fall" : "Rise"}${axis}1`, `Cap${axis === "E" ? "Rise" : "Fall"}${axis}1`];
    if (depth === "OnePoint5") return [`Cap${axis === "E" ? "Fall" : "Rise"}${axis}1`, `PeakOnePt5${axis}`, `Cap${axis === "E" ? "Rise" : "Fall"}${axis}1`];
    if (depth === "Two") return axis === "E" ? ["CapFallE1", "CapFallE2", "CapRiseE2", "CapRiseE1"] : ["CapRiseS1", "CapRiseS2", "CapFallS2", "CapFallS1"];
    if (depth === "TwoPoint5") return axis === "E" ? ["CapFallE1", "CapFallE2", "PeakTwoPt5E", "CapRiseE2", "CapRiseE1"] : ["CapRiseS1", "CapRiseS2", "PeakTwoPt5S", "CapFallS2", "CapFallS1"];
    if (depth === "Three") return axis === "E" ? ["CapFallE1", "CapFallE2", "CapFallE3", ...Array(Math.max(0, length - 6)).fill("CapGapE3"), "CapRiseE3", "CapRiseE2", "CapRiseE1"] : ["CapRiseS1", "CapRiseS2", "CapRiseS3", ...Array(Math.max(0, length - 6)).fill("CapGapS3"), "CapFallS3", "CapFallS2", "CapFallS1"];
    return [];
}

function capSide(depth: Depth, axis: "E" | "S", direction: "Rise" | "Fall"): string[] {
    const count = depth === "Three" || depth === "TwoPoint5" ? 3 : depth === "Two" || depth === "OnePoint5" ? 2 : depth === "One" ? 1 : 0;
    const values = Array.from({ length: count }, (_, i) => `Cap${direction}${axis}${i + 1}`);
    return direction === "Fall" && axis === "S" || direction === "Rise" && axis === "E" ? values.reverse() : values;
}
function shallowSide(axis: "E" | "S", direction: "Rise" | "Fall", length: number): string[] {
    const values = [`CapShallow${direction}${axis}1`]; if (length > 1) values.push(`CapShallow${direction}${axis}2`);
    return direction === "Rise" && axis === "E" || direction === "Fall" && axis === "S" ? values.reverse() : values;
}
function shallowPeak(axis: "E" | "S", length: number): string[] {
    const fall = `CapShallowFall${axis}`, rise = `CapShallowRise${axis}`;
    return [`${axis === "E" ? fall : rise}1`, ...(length > 2 ? [`${axis === "E" ? fall : rise}2`, `${axis === "E" ? rise : fall}2`] : []), `${axis === "E" ? rise : fall}1`];
}
function eastPattern(d: Depth): string[] { return d === "Point5" ? ["SlopePt5E"] : d === "One" ? ["SlopeE1"] : d === "OnePoint5" ? ["SlopeOnePt5E", "SlopeE1"] : d === "Two" ? ["SlopeE2", "SlopeE1"] : d === "TwoPoint5" ? ["SlopeTwoPt5E", "SlopeE2", "SlopeE1"] : ["SlopeE3", "SlopeE2", "SlopeE1"]; }
function southPattern(d: Depth): string[] { return d === "Point5" ? ["SlopePt5S"] : d === "One" ? ["SlopeS1"] : d === "OnePoint5" ? ["SlopeOnePt5S", "SlopeS1"] : d === "Two" ? ["SlopeS2", "SlopeS1"] : d === "TwoPoint5" ? ["SlopeTwoPt5S", "SlopeS2", "SlopeS1"] : ["SlopeS3", "SlopeS2", "SlopeS1"]; }
function slopeThickness(o: RoofPlacementOptions): number { const n = ["PeakWE", "DormerW", "DormerE"].includes(o.roofType) ? o.height : o.width; return Math.ceil(Math.min(n, 6) / 2); }
function inner(d: Depth): string { return d === "Point5" ? "InnerPt5" : d === "OnePoint5" ? "InnerOnePt5" : d === "TwoPoint5" ? "InnerTwoPt5" : `Inner${depthBands(d)}`; }
function outer(d: Depth): string { return d === "Point5" ? "OuterPt5" : d === "OnePoint5" ? "OuterOnePt5" : d === "TwoPoint5" ? "OuterTwoPt5" : `Outer${depthBands(d)}`; }
function eastAt(d: Depth): string { return d === "OnePoint5" ? "SlopeOnePt5E" : d === "TwoPoint5" ? "SlopeTwoPt5E" : `SlopeE${depthBands(d)}`; }
function southAt(d: Depth): string { return d === "OnePoint5" ? "SlopeOnePt5S" : d === "TwoPoint5" ? "SlopeTwoPt5S" : `SlopeS${depthBands(d)}`; }
function depthBands(d: Depth): number { return d === "Point5" || d === "One" ? 1 : d === "OnePoint5" || d === "Two" ? 2 : 3; }
function peakDepth(n: number): Depth { return n <= 1 ? "Point5" : n === 2 ? "One" : n === 3 ? "OnePoint5" : n === 4 ? "Two" : n === 5 ? "TwoPoint5" : "Three"; }
function integerDepth(n: number): Depth { return n <= 1 ? "One" : n === 2 ? "Two" : "Three"; }
function bounds(o: RoofPlacementOptions): Rect { return { x: o.x, y: o.y, width: o.width, height: o.height }; }
function clamp(n: number, min: number, max: number): number { return Math.max(min, Math.min(n, max)); }
function find(tiles: RoofTileSource[], name: string): RoofTileSource | undefined { return tiles.find(tile => tile.enum === name); }
function parseOffset(value?: string): [number, number] { const values = (value || "0 0").trim().split(/\s+/).map(Number); return [values[0] || 0, values[1] || 0]; }
