import { buildRoofPlacements, calculateRoofDepth, RoofTileSource } from "./roof-patterns";

const tile = (name: string, offset?: string): RoofTileSource => ({ enum: name, tile: name, offset });
const capNames = [
    "CapRiseS1", "CapRiseS2", "CapRiseS3", "CapFallS1", "CapFallS2", "CapFallS3",
    "CapRiseE1", "CapRiseE2", "CapRiseE3", "CapFallE1", "CapFallE2", "CapFallE3",
    "PeakPt5S", "PeakOnePt5S", "PeakTwoPt5S", "PeakPt5E", "PeakOnePt5E", "PeakTwoPt5E",
    "CapGapS3", "CapGapE3",
];
const slopeNames = [
    "SlopeE1", "SlopeE2", "SlopeE3", "SlopeS1", "SlopeS2", "SlopeS3",
    "SlopePt5E", "SlopeOnePt5E", "SlopeTwoPt5E", "SlopePt5S", "SlopeOnePt5S", "SlopeTwoPt5S",
];

describe("BuildingEd roof placement", () => {
    it("uses half-depth roof enums for odd peak widths", () => {
        expect(calculateRoofDepth(5, 4, "PeakNS")).toBe("TwoPoint5");
        const result = buildRoofPlacements({
            x: 10, y: 20, level: 0, width: 5, height: 4, roofType: "PeakNS",
            tileset: { capTiles: capNames.map(name => tile(name)), slopeTiles: slopeNames.map(name => tile(name)), topTiles: [] },
        });
        const slopes = result.filter(value => value.layer === "Roof");
        expect(slopes.length).toBe(12);
        expect(slopes.slice(0, 3).map(value => value.name)).toEqual([
            "SlopeTwoPt5E.png", "SlopeE2.png", "SlopeE1.png",
        ]);
        expect(slopes.slice(0, 3).map(value => value.x)).toEqual([12, 13, 14]);
        const caps = result.filter(value => value.layer === "RoofCap");
        expect(caps.length).toBe(10);
        expect(caps.slice(0, 5).map(value => value.name)).toEqual([
            "CapRiseS1.png", "CapRiseS2.png", "PeakTwoPt5S.png", "CapFallS2.png", "CapFallS1.png",
        ]);
        expect(caps.slice(5).every(value => value.y === 24)).toBeTrue();
    });

    it("uses both coordinates from BuildingEd tile offsets", () => {
        const result = buildRoofPlacements({
            x: 0, y: 0, level: 0, width: 1, height: 1, roofType: "PeakNS",
            tileset: {
                capTiles: [tile("PeakPt5S")],
                slopeTiles: [tile("SlopePt5E", "1 -2")],
                topTiles: [],
            },
        });
        const slope = result.find(value => value.layer === "Roof")!;
        expect(slope.offsetX).toBe(1);
        expect(slope.offsetY).toBe(-2);
    });

    it("keeps caps on cap layers when a slope occupies the same square", () => {
        const result = buildRoofPlacements({
            x: 0, y: 0, level: 0, width: 1, height: 1, roofType: "PeakNS",
            tileset: {
                capTiles: [tile("PeakPt5S")],
                slopeTiles: [tile("SlopePt5E")],
                topTiles: [],
            },
            hasRoofTile: () => true,
            hasRoofCapTile: () => false,
        });
        expect(result.filter(value => value.name === "PeakPt5S.png").every(value => value.layer === "RoofCap")).toBeTrue();
    });
});
