import { FurnishingPlacementRequest, FurnishingPreparation, PhysicalRoom } from '../models/auto-furnishing.models';

export const FURNISHING_RECIPES: Readonly<Record<string, { label: string; requests: FurnishingPlacementRequest[] }>> = {
    bedroom: { label: 'Bedroom', requests: [
        { id: 'bed', role: 'bed', count: 1, required: true, priority: 10 },
        { id: 'chair', catalogIds: ['basic.chair'], count: 1, required: false }
    ] },
    bathroom: { label: 'Bathroom', requests: [
        { id: 'toilet', catalogIds: ['basic.toilet'], count: 1, required: true, priority: 10 },
        { id: 'sink', catalogIds: ['basic.sink'], count: 1, required: true, priority: 9 }
    ] },
    diningroom: { label: 'Dining room', requests: [
        { id: 'table', catalogIds: ['basic.dining-table'], count: 1, required: true, priority: 10 },
        { id: 'chairs', catalogIds: ['basic.chair'], count: 2, required: true, priority: 9,
            near: { requestId: 'table', maxDistance: 2, faceTarget: true } }
    ] },
    kitchen: { label: 'Kitchen', requests: [
        { id: 'sink', role: 'sink', count: 1, required: true, priority: 20, order: 0 },
        { id: 'counter', role: 'counter', count: 1, required: true, priority: 19, order: 1,
            near: { requestId: 'sink', maxDistance: 1, sameFacing: true } },
        { id: 'cooker', role: 'cooker', count: 1, required: true, priority: 18, order: 3,
            near: { requestId: 'counter', maxDistance: 3 } },
        { id: 'refrigerator', role: 'refrigerator', count: 1, required: true, priority: 17, order: 4,
            near: { requestId: 'sink', maxDistance: 4 } },
        { id: 'extra-counter', role: 'counter', count: 1, required: false, order: 2,
            near: { requestId: 'counter', maxDistance: 1, sameFacing: true, extendRun: true } }
    ] },
    livingroom: { label: 'Living room', requests: [
        { id: 'coffee-table', role: 'coffee-table', count: 1, required: true, priority: 20 },
        { id: 'sofa', role: 'sofa', count: 1, required: true, priority: 19,
            near: { requestId: 'coffee-table', maxDistance: 2, faceTarget: true } },
        { id: 'armchair', role: 'armchair', count: 1, required: false, priority: 2,
            near: { requestId: 'coffee-table', maxDistance: 2, faceTarget: true } },
        { id: 'television', role: 'television', count: 1, required: false,
            near: { requestId: 'sofa', maxDistance: 5, faceTarget: true, targetFacesCandidate: true } }
    ] }
};

export const FURNISHING_STYLES = [
    { id: 'basic-residential', label: 'Residential A' },
    { id: 'alternate-residential', label: 'Residential B' }
] as const;
export type FurnishingStyle = typeof FURNISHING_STYLES[number]['id'];

/** Explicit role palettes coordinate selected rooms; neutral fixtures are shared. No asset fallback. */
export function furnishingRecipeRequests(roomType: string, style: FurnishingStyle, room?: PhysicalRoom): FurnishingPlacementRequest[] {
    const alternate = style === 'alternate-residential';
    const palette: Record<string, string[]> = {
        bed: ['basic.single-bed', 'basic.double-bed'], chair: [alternate ? 'alternate.chair' : 'basic.chair'],
        'dining-table': [alternate ? 'alternate.dining-table' : 'basic.dining-table'], toilet: ['basic.toilet'],
        sink: [alternate ? 'alternate.sink' : 'basic.sink'], refrigerator: ['basic.refrigerator'], cooker: ['basic.cooker'],
        counter: [alternate ? 'alternate.counter' : 'basic.counter'], sofa: [alternate ? 'alternate.sofa' : 'basic.sofa'],
        armchair: [alternate ? 'alternate.armchair' : 'basic.armchair'],
        'coffee-table': [alternate ? 'alternate.coffee-table' : 'basic.coffee-table'], television: ['basic.television']
    };
    return FURNISHING_RECIPES[roomType].requests.map(request => {
        const role = request.role || request.catalogIds![0].replace(/^basic\./, '');
        const expand = (request.id === 'extra-counter' && (room?.availableCells.length || 0) >= 50) ||
            (request.id === 'armchair' && (room?.availableCells.length || 0) >= 60);
        const count = expand ? 2 : request.count;
        return { ...request, count, role, catalogIds: [...palette[role]], ...(request.near ? { near: { ...request.near } } : {}) };
    });
}

/** Empty means no furniture objects or manually painted furniture, including rugs. */
export function furnishingRoomReason(preparation: FurnishingPreparation, room: PhysicalRoom): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(FURNISHING_RECIPES, room.suggestedType)) return 'Only bedrooms, bathrooms, dining rooms, kitchens and living rooms are supported.';
    if (room.obstacles.some(obstacle => ['furniture', 'unknown-furniture', 'manual-tile', 'unknown-object'].includes(obstacle.kind)))
        return 'This room already contains furniture or manual object tiles. Only empty rooms can be furnished.';
    if (room.needsReview) return preparation.analysis.diagnostics.find(d => d.preventsPlanning &&
        (d.roomId ? d.roomId === room.id : d.level === room.level))?.message || 'Room geometry needs review.';
    if (room.cells.length > 4096) return 'This room exceeds the 4096-cell planning limit.';
    return undefined;
}
