import { Furniture, Point, TileArea } from './app.models';

export type FurnishingRoomType = 'bedroom' | 'bathroom' | 'kitchen' | 'livingroom' | 'diningroom' | 'hall' | 'office' | 'unknown';
export type FurnitureFacing = 'W' | 'N' | 'E' | 'S';
export interface FurnishingEdge {
    level: number; x: number; y: number; axis: 'N' | 'W'; wall: boolean;
    opening?: { kind: 'door' | 'window'; uid: string };
}
export interface FurnitureVariantMetadata {
    orient: FurnitureFacing;
    renderCells: Point[];
    footprint: Point[];
    blockedCells: Point[];
    accessCells: Point[];
    wallEdges: { x: number; y: number; side: FurnitureFacing }[];
    surfaceCells: Point[];
}
export interface FurnishingCatalogItem {
    id: string; label: string; role: string; style: string; weight: number;
    compatibleStyles?: string[];
    roomTypes: FurnishingRoomType[];
    support: 'floor' | 'surface';
    definition: Furniture;
    variants: FurnitureVariantMetadata[];
    requiredTiles: string[];
}
export interface FurnishingDiagnostic {
    code: string; message: string; level?: number; uid?: string; roomId?: string; catalogId?: string;
    preventsPlanning?: boolean;
}
export interface FurnishingCatalog {
    version: number; items: FurnishingCatalogItem[]; diagnostics: FurnishingDiagnostic[];
}
export interface FurnishingEntrance {
    edge: FurnishingEdge;
    kind: 'door' | 'open';
    inside: Point; outside: Point;
    targetRoomId?: string;
    exterior: boolean;
}
export interface FurnishingObstacle {
    kind: 'furniture' | 'unknown-furniture' | 'stairs' | 'stair-landing' | 'missing-floor' | 'manual-tile' | 'unknown-object';
    level: number; uid?: string; catalogId?: string;
    blocksMovement: boolean;
    cells: Point[];
    accessCells?: Point[];
    surfaceCells?: Point[];
}
export interface PhysicalRoom {
    // Derived identity, stable for an unchanged region; not a persistent document UID.
    id: string; level: number; roomIndex: number; name: string;
    suggestedType: FurnishingRoomType;
    needsReview: boolean;
    cells: Point[]; bounds: TileArea;
    boundaries: FurnishingEdge[];
    entrances: FurnishingEntrance[];
    windowEdges: FurnishingEdge[];
    obstacles: FurnishingObstacle[];
    reservedCells: Point[];
    blockedCells: Point[];
    availableCells: Point[];
}
export interface FurnishingAnalysis {
    rooms: PhysicalRoom[]; edges: FurnishingEdge[]; obstacles: FurnishingObstacle[];
    diagnostics: FurnishingDiagnostic[];
}
export interface FurnishingPreparation {
    analysis: FurnishingAnalysis;
    catalog: FurnishingCatalog;
    availability: { catalogId: string; orient: FurnitureFacing; available: boolean; missingTiles: string[] }[];
}

export interface FurnishingPlacementInput { catalogId: string; orient: FurnitureFacing; x: number; y: number; }
export interface FurnishingPlacementScore {
    wallAffinity: number; doorClearance: number; circulation: number; style: number; space: number; total: number;
}
export interface FurnishingPlacement extends FurnishingPlacementInput {
    // Stable proposal identity, not a document object UID.
    id: string; roomId: string; level: number; layer: string;
    supportId?: string;
    footprint: Point[]; blockedCells: Point[]; accessCells: Point[]; surfaceCells: Point[];
    score: FurnishingPlacementScore;
}
export interface FurnishingPlacementValidation {
    valid: boolean; reasons: string[]; placement?: FurnishingPlacement;
}
export interface FurnishingEngineOptions {
    seed?: string | number;
    roomType?: Exclude<FurnishingRoomType, 'unknown'>;
    style?: string;
    maxCoverage?: number;
    maxCandidateChecks?: number;
    maxSearchChecks?: number;
    beamWidth?: number;
    branchesPerState?: number;
    candidatesPerState?: number;
    spatialDiversity?: boolean;
}
/** Later recipes supply these goals explicitly; the engine does not invent room recipes. */
export interface FurnishingPlacementRequest {
    id: string; role?: string; catalogIds?: string[]; count: number; required?: boolean; priority?: number;
    order?: number;
    near?: { requestId: string; maxDistance: number; faceTarget?: boolean; targetFacesCandidate?: boolean; sameFacing?: boolean; extendRun?: boolean };
}
export interface FurnishingCandidateResult {
    candidates: FurnishingPlacement[]; diagnostics: FurnishingDiagnostic[]; checks: number; truncated: boolean;
}
export interface FurnishingRoomPlan {
    roomId: string; seed: string; status: 'complete' | 'partial' | 'blocked';
    placements: (FurnishingPlacement & { requestId: string })[];
    unfilled: { requestId: string; count: number; required: boolean }[];
    requiredSatisfied: boolean; score: number; diagnostics: FurnishingDiagnostic[];
    stats: { candidateChecks: number; searchChecks: number; truncated: boolean };
}
