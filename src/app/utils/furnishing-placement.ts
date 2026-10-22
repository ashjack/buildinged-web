import { Point } from '../models/app.models';
import { FurnishingCatalogItem, FurnishingDiagnostic, FurnishingEngineOptions, FurnishingPlacement, FurnishingPlacementInput,
    FurnishingPlacementRequest, FurnishingPlacementValidation, FurnishingPreparation, FurnishingRoomPlan, FurnishingCandidateResult,
    FurnitureVariantMetadata, PhysicalRoom } from '../models/auto-furnishing.models';
import { furnishingCellKey as key } from './furnishing-room-analysis';
import { edgeBetween, furnishingEdgeKey, FurnishingNavigation } from './furnishing-connectivity';

const DEFAULTS = { seed: '0', maxCoverage: 1, maxCandidateChecks: 12000, maxSearchChecks: 20000,
    beamWidth: 12, branchesPerState: 8, candidatesPerState: 256 };
type Options = FurnishingEngineOptions & typeof DEFAULTS;
interface Occupant { id: string; layer: string; cells: Point[]; blocks: boolean; access: Point[]; surfaces: Point[]; }
interface Context {
    room: PhysicalRoom; prep: FurnishingPreparation; options: Options;
    items: Map<string, FurnishingCatalogItem>; variants: Map<string, FurnitureVariantMetadata>;
    nav: FurnishingNavigation; edges: Map<string, FurnishingPreparation['analysis']['edges'][number]>;
    hard: Set<string>; forbiddenAccess: Set<string>; existing: Occupant[]; existingAccess: Point[]; baselineDeadEnds: number;
}
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const intersects = (cells: Point[], other: Point[]) => { const set = new Set(other.map(key)); return cells.some(cell => set.has(key(cell))); };
const variantId = (id: string, orient: string) => JSON.stringify([id, orient]);
const proposalId = (room: string, input: FurnishingPlacementInput) => JSON.stringify([room, input.catalogId, input.orient, input.x, input.y]);
const allIn = (cells: Point[], set: Set<string>) => cells.every(cell => set.has(key(cell)));
function diagnostic(code: string, message: string, roomId: string): FurnishingDiagnostic { return { code, message, roomId }; }
function hash(text: string): number {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15;
    return value >>> 0;
}
function tie(ctx: Context, placement: FurnishingPlacement): number {
    const unit = (hash(JSON.stringify([ctx.options.seed, placement.id])) + 1) / 4294967297;
    return -Math.log(unit) / ctx.items.get(placement.catalogId)!.weight;
}
function validVariant(item: FurnishingCatalogItem, variant: FurnitureVariantMetadata): boolean {
    const cells = [...variant.footprint, ...variant.renderCells, ...variant.blockedCells, ...variant.accessCells, ...variant.surfaceCells];
    const footprint = new Set(variant.footprint.map(key));
    return ['W', 'N', 'E', 'S'].includes(variant.orient) && footprint.has('0:0') && footprint.size <= 4096 && footprint.size === variant.footprint.length &&
        cells.every(cell => Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y)) &&
        variant.footprint.every(cell => cell.x >= 0 && cell.y >= 0) &&
        allIn([...variant.renderCells, ...variant.blockedCells, ...variant.surfaceCells], footprint) &&
        variant.accessCells.every(cell => !footprint.has(key(cell))) &&
        variant.wallEdges.every(edge => Number.isSafeInteger(edge.x) && Number.isSafeInteger(edge.y) && footprint.has(key(edge)) && ['W', 'N', 'E', 'S'].includes(edge.side)) &&
        item.definition.entries.some(entry => entry.orient === variant.orient && entry.tiles.length > 0 &&
            entry.tiles.every(tile => variant.renderCells.some(cell => cell.x === tile.x && cell.y === tile.y))) &&
        (item.support === 'floor' || item.support === 'surface' && !variant.blockedCells.length);
}
function context(prep: FurnishingPreparation, roomId: string, supplied: FurnishingEngineOptions): { ctx?: Context; diagnostics: FurnishingDiagnostic[] } {
    const options = { ...DEFAULTS, ...supplied, seed: String(supplied.seed ?? '0') }, diagnostics: FurnishingDiagnostic[] = [];
    const fail = (code: string, message: string) => ({ diagnostics: [diagnostic(code, message, roomId)] });
    if ((supplied.roomType && !['bedroom', 'bathroom', 'kitchen', 'livingroom', 'diningroom', 'hall', 'office'].includes(supplied.roomType)) ||
        (supplied.spatialDiversity !== undefined && typeof supplied.spatialDiversity !== 'boolean') ||
        (typeof supplied.seed === 'number' && !Number.isFinite(supplied.seed)) || !Number.isFinite(options.maxCoverage) || options.maxCoverage < 0 || options.maxCoverage > 1 ||
        !['maxCandidateChecks', 'maxSearchChecks', 'beamWidth', 'branchesPerState', 'candidatesPerState'].every(name => {
            const value = options[name as keyof typeof DEFAULTS]; return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= (name === 'beamWidth' || name === 'branchesPerState' ? 64 : 1000000);
        })) return fail('invalid-engine-options', 'Engine limits must be finite positive integers; coverage must be between zero and one.');
    const room = prep.analysis.rooms.find(room => room.id === roomId);
    if (!room) return fail('room-not-found', 'The physical room is no longer present in this preparation.');
    if (room.cells.length > 4096) return fail('room-too-large', 'Room planning currently supports at most 4096 cells per region.');
    const blockers = prep.analysis.diagnostics.filter(d => d.preventsPlanning && (d.roomId ? d.roomId === roomId : d.level === room.level) &&
        !(d.code === 'unknown-room-type' && options.roomType));
    if (blockers.length) return { diagnostics: [...blockers] };
    if (room.needsReview && !(options.roomType && room.suggestedType === 'unknown')) return fail('room-needs-review', 'Resolve this room’s analysis diagnostics before planning.');
    if ((options.roomType || room.suggestedType) === 'unknown') return fail('unknown-room-type', 'Select a room type before planning.');
    const edges = new Map(prep.analysis.edges.filter(edge => edge.level === room.level).map(edge => [furnishingEdgeKey(edge.x, edge.y, edge.axis), edge]));
    const nav = new FurnishingNavigation(room, edges);
    if (nav.missingEdges.length) return fail('missing-room-geometry', 'Room navigation requires complete structural edge data.');
    if (!nav.entranceCells.length) return fail('no-walkable-entrance', 'All room entrances are blocked or missing.');
    const items = new Map<string, FurnishingCatalogItem>(), variants = new Map<string, FurnitureVariantMetadata>(), invalidVariants = new Set<string>();
    for (const item of [...prep.catalog.items].sort((a, b) => compareText(a.id, b.id))) {
        if (items.has(item.id)) return fail('duplicate-catalog-id', 'Furniture catalog IDs must be unique.');
        items.set(item.id, item);
        if (!Number.isFinite(item.weight) || item.weight <= 0) { diagnostics.push(diagnostic('invalid-catalog-weight', `Invalid selection weight for ${item.id}.`, roomId)); continue; }
        for (const variant of item.variants) {
            const id = variantId(item.id, variant.orient);
            if (!validVariant(item, variant) || variants.has(id) || invalidVariants.has(id)) {
                variants.delete(id); invalidVariants.add(id);
                diagnostics.push(diagnostic('invalid-catalog-variant', `Invalid or duplicate variant ${item.id}/${variant.orient}.`, roomId)); continue;
            }
            if (!item.roomTypes.includes(options.roomType || room.suggestedType)) continue;
            if (prep.availability.some(available => available.catalogId === item.id && available.orient === variant.orient && available.available)) variants.set(id, variant);
        }
    }
    const existing: Occupant[] = [], accounted = new Set<string>(), hard = new Set<string>(), forbiddenAccess = new Set<string>();
    for (const obstacle of room.obstacles) {
        if (obstacle.kind === 'stairs' || obstacle.kind === 'stair-landing') obstacle.cells.forEach(cell => forbiddenAccess.add(key(cell)));
        [...obstacle.cells, ...(obstacle.accessCells || [])].forEach(cell => accounted.add(key(cell)));
        const item = items.get(obstacle.catalogId || '');
        if (obstacle.kind === 'furniture' && item) {
            existing.push({ id: `existing:${obstacle.uid || JSON.stringify([obstacle.catalogId, [...obstacle.cells].map(key).sort()])}`,
                layer: item.definition.layer || 'Furniture', cells: obstacle.cells, blocks: obstacle.blocksMovement,
                access: obstacle.accessCells || [], surfaces: obstacle.surfaceCells || [] });
        } else obstacle.cells.forEach(cell => hard.add(key(cell)));
    }
    room.entrances.forEach(entrance => hard.add(key(entrance.inside)));
    room.reservedCells.filter(cell => !accounted.has(key(cell))).forEach(cell => hard.add(key(cell)));
    // A prepared blocked cell not explained by classified furniture is always a hard obstacle.
    const classifiedCells = new Set(existing.filter(item => item.blocks).flatMap(item => item.cells.map(key)));
    room.blockedCells.filter(cell => !classifiedCells.has(key(cell))).forEach(cell => hard.add(key(cell)));
    existing.sort((a, b) => compareText(a.id, b.id));
    const existingAccess = existing.flatMap(item => item.access).filter(cell => nav.initiallyReachable.has(key(cell)));
    if (existing.some(item => item.access.some(cell => nav.cells.has(key(cell)) && !nav.initiallyReachable.has(key(cell))))) {
        diagnostics.push(diagnostic('existing-access-unreachable', 'Some existing furniture is already inaccessible; its current footprint and clearances are preserved.', roomId));
    }
    return { ctx: { room, prep, options, items, variants, nav, edges, hard, forbiddenAccess, existing, existingAccess, baselineDeadEnds: nav.deadEnds(nav.baselineBlocked) }, diagnostics };
}
function occupant(placement: FurnishingPlacement): Occupant {
    return { id: placement.id, layer: placement.layer, cells: placement.footprint, blocks: !!placement.blockedCells.length, access: placement.accessCells, surfaces: placement.surfaceCells };
}
function blocked(ctx: Context, placements: FurnishingPlacement[]): Set<string> {
    return new Set([...ctx.nav.baselineBlocked, ...placements.flatMap(placement => placement.blockedCells.map(key))]);
}
function scoring(ctx: Context, placement: FurnishingPlacement, placements: FurnishingPlacement[]) {
    const occupied = blocked(ctx, placements), styles = new Map<string, number>();
    for (const item of [...ctx.room.obstacles.map(obstacle => ctx.items.get(obstacle.catalogId || '')), ...placements.map(p => ctx.items.get(p.catalogId))]) {
        if (item) styles.set(item.style, (styles.get(item.style) || 0) + 1);
    }
    const preferred = ctx.options.style || [...styles].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))[0]?.[0];
    let walls = 0;
    for (const cell of placement.footprint) for (const side of ['N', 'W', 'E', 'S']) {
        const edge = ctx.edges.get(furnishingEdgeKey(cell.x + (side === 'E' ? 1 : 0), cell.y + (side === 'S' ? 1 : 0), side === 'W' || side === 'E' ? 'W' : 'N'));
        if (edge?.wall && !edge.opening) walls++;
    }
    let distance = 4;
    for (const cell of placement.footprint) for (const entrance of ctx.room.entrances) distance = Math.min(distance, Math.abs(cell.x - entrance.inside.x) + Math.abs(cell.y - entrance.inside.y));
    // A coffee table anchors a seating group in usable interior space, rather than facing a sofa into a corner.
    const wallAffinity = ctx.items.get(placement.catalogId)!.role === 'coffee-table' ? (walls === 0 ? 20 : 0)
        : Math.min(20, Math.round(20 * walls / Math.max(1, placement.footprint.length * 2)));
    const doorClearance = 3 * distance, circulation = Math.max(0, 12 - 2 * Math.max(0, ctx.nav.deadEnds(occupied) - ctx.baselineDeadEnds));
    const item = ctx.items.get(placement.catalogId)!;
    const style = item.style === preferred || !!preferred && !!item.compatibleStyles?.includes(preferred) ? 20 : 0;
    const space = Math.round(10 * (ctx.room.cells.length - occupied.size) / ctx.room.cells.length);
    return { wallAffinity, doorClearance, circulation, style, space, total: wallAffinity + doorClearance + circulation + style + space };
}
function evaluate(ctx: Context, input: FurnishingPlacementInput, placed: FurnishingPlacement[], deferSupport = false): FurnishingPlacementValidation {
    const item = ctx.items.get(input.catalogId), variant = ctx.variants.get(variantId(input.catalogId, input.orient));
    const reject = (...reasons: string[]) => ({ valid: false, reasons });
    if (!item || !variant) return reject('unavailable-or-incompatible-variant');
    if (!Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y)) return reject('invalid-origin');
    const shift = (cells: Point[]) => cells.map(cell => ({ x: input.x + cell.x, y: input.y + cell.y }));
    const placement: FurnishingPlacement = { catalogId: input.catalogId, orient: input.orient, x: input.x, y: input.y,
        id: proposalId(ctx.room.id, input), roomId: ctx.room.id, level: ctx.room.level,
        layer: item.definition.layer || 'Furniture', footprint: shift(variant.footprint), blockedCells: shift(variant.blockedCells),
        accessCells: shift(variant.accessCells), surfaceCells: shift(variant.surfaceCells),
        score: { wallAffinity: 0, doorClearance: 0, circulation: 0, style: 0, space: 0, total: 0 } };
    const membership = new Set(ctx.nav.cells.keys()), footprint = new Set(placement.footprint.map(key));
    if (!allIn([...placement.footprint, ...placement.accessCells], membership)) return reject('outside-room');
    if (placement.footprint.some(cell => ctx.hard.has(key(cell)))) return reject('reserved-footprint');
    if (placement.accessCells.some(cell => ctx.forbiddenAccess.has(key(cell)))) return reject('clearance-on-stairs');
    for (const cell of placement.footprint) for (const next of [{ x: cell.x + 1, y: cell.y }, { x: cell.x, y: cell.y + 1 }]) {
        const edge = ctx.edges.get(edgeBetween(cell, next));
        if (footprint.has(key(next)) && (edge?.wall || edge?.opening)) return reject('crosses-wall-or-opening');
    }
    for (const anchor of variant.wallEdges) {
        const x = input.x + anchor.x, y = input.y + anchor.y;
        const edge = ctx.edges.get(furnishingEdgeKey(x + (anchor.side === 'E' ? 1 : 0), y + (anchor.side === 'S' ? 1 : 0), anchor.side === 'W' || anchor.side === 'E' ? 'W' : 'N'));
        if (!edge?.wall || edge.opening) return reject('wall-anchor-missing');
    }
    // Access must meet the furniture through an open edge, not merely be reachable elsewhere around a wall.
    const accessKeys = new Set(placement.accessCells.map(key)), contacts: string[] = [];
    for (const cell of placement.accessCells) for (const offset of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        const next = { x: cell.x + offset.x, y: cell.y + offset.y }, edge = ctx.edges.get(edgeBetween(cell, next));
        if (footprint.has(key(next)) && edge && !edge.wall && !edge.opening) contacts.push(key(cell));
    }
    const connectedAccess = new Set(contacts), queue = [...connectedAccess];
    for (let i = 0; i < queue.length; i++) for (const next of ctx.nav.neighbours.get(queue[i]) || []) {
        if (accessKeys.has(next) && !connectedAccess.has(next)) { connectedAccess.add(next); queue.push(next); }
    }
    if (placement.accessCells.some(cell => !connectedAccess.has(key(cell)))) return reject('clearance-separated-by-wall');
    const occupants = [...ctx.existing, ...placed.map(occupant)];
    if (placed.some(other => other.id === placement.id)) return reject('duplicate-placement');
    const support = item.support === 'surface' ? occupants.filter(other => allIn(placement.footprint, new Set(other.surfaces.map(key)))).sort((a, b) => compareText(a.id, b.id))[0] : undefined;
    if (item.support === 'surface' && !support && !deferSupport) return reject('support-surface-missing');
    if (support) placement.supportId = support.id;
    for (const other of occupants) {
        if (!intersects(placement.footprint, other.cells)) continue;
        if (other.id === support?.id) continue;
        // Floor rugs may coexist with floor furniture, but not with another rug on the same layer.
        const rugOverlap = placement.layer !== other.layer &&
            (placement.layer === 'FloorFurniture' && !placement.blockedCells.length || other.layer === 'FloorFurniture' && !other.blocks);
        if (!rugOverlap) return reject('furniture-overlap');
    }
    if (placement.blockedCells.some(cell => !ctx.nav.initiallyReachable.has(key(cell)))) return reject('placement-unreachable');
    const protectedAccess = [...ctx.existing.flatMap(other => other.access), ...placed.flatMap(other => other.accessCells)];
    if (intersects(placement.blockedCells, protectedAccess)) return reject('clearance-blocked');
    const occupied = blocked(ctx, [...placed, placement]);
    if (placement.accessCells.some(cell => occupied.has(key(cell)))) return reject('clearance-blocked');
    if (occupied.size > ctx.room.cells.length * ctx.options.maxCoverage && placement.blockedCells.length) return reject('coverage-limit');
    const access = [...ctx.existingAccess, ...placed.flatMap(other => other.accessCells), ...placement.accessCells];
    const reasons = ctx.nav.check(occupied, access);
    if (reasons.length) return reject(...reasons);
    placement.score = scoring(ctx, placement, [...placed, placement]);
    return { valid: true, reasons: [], placement };
}
function compareCandidates(ctx: Context, a: FurnishingPlacement, b: FurnishingPlacement): number {
    return b.score.total - a.score.total || tie(ctx, a) - tie(ctx, b) || compareText(a.id, b.id);
}
function canonicalPlaced(ctx: Context, inputs: FurnishingPlacementInput[]): FurnishingPlacement[] | undefined {
    const placed: FurnishingPlacement[] = [];
    for (const input of inputs) { const result = evaluate(ctx, input, placed); if (!result.valid) return undefined; placed.push(result.placement!); }
    return placed;
}
/** Re-derives every mask from catalog metadata; caller-provided proposal masks cannot bypass validation. */
export function validateFurnishingPlacement(prep: FurnishingPreparation, roomId: string, input: FurnishingPlacementInput,
    placed: FurnishingPlacementInput[] = [], options: FurnishingEngineOptions = {}): FurnishingPlacementValidation {
    const setup = context(prep, roomId, options);
    if (!setup.ctx) return { valid: false, reasons: setup.diagnostics.map(diagnostic => diagnostic.code) };
    const canonical = canonicalPlaced(setup.ctx, placed);
    return canonical ? evaluate(setup.ctx, input, canonical) : { valid: false, reasons: ['invalid-existing-plan'] };
}
function enumerate(ctx: Context, ids: Set<string> | undefined, placed: FurnishingPlacement[], deferSupport: boolean): { candidates: FurnishingPlacement[]; checks: number; truncated: boolean } {
    const candidates: FurnishingPlacement[] = []; let checks = 0;
    const lanes: { catalogId: string; orient: FurnitureVariantMetadata['orient'] }[] = [];
    for (const item of [...ctx.items.values()].sort((a, b) => compareText(a.id, b.id))) {
        if (ids && !ids.has(item.id)) continue;
        for (const variant of [...item.variants].sort((a, b) => compareText(a.orient, b.orient))) {
            if (!ctx.variants.has(variantId(item.id, variant.orient))) continue;
            lanes.push({ catalogId: item.id, orient: variant.orient });
        }
    }
    const cells = [...ctx.nav.cells.values()];
    if (ctx.options.spatialDiversity) {
        const groups = new Map<string, Point[]>();
        for (const cell of cells) { const id = spatialBucket(ctx, cell); const group = groups.get(id) || []; group.push(cell); groups.set(id, group); }
        cells.length = 0;
        const ordered = [...groups].sort((a, b) => compareText(a[0], b[0])).map(([, group]) => group);
        for (let i = 0; ordered.some(group => i < group.length); i++) for (const group of ordered) if (group[i]) cells.push(group[i]);
    }
    const total = cells.length * lanes.length, count = Math.min(total, ctx.options.maxCandidateChecks);
    for (let index = 0; index < count; index++) {
        // Spatial searches share a truncated budget across roles/orientations instead of exhausting it on the first item.
        const lane = lanes[ctx.options.spatialDiversity ? index % lanes.length : Math.floor(index / cells.length)];
        const cell = cells[ctx.options.spatialDiversity ? Math.floor(index / lanes.length) : index % cells.length];
        checks++;
        const result = evaluate(ctx, { ...lane, ...cell }, placed, deferSupport);
        if (result.valid) candidates.push(result.placement!);
    }
    return { candidates: candidates.sort((a, b) => compareCandidates(ctx, a, b)), checks, truncated: count < total };
}
function spatialBucket(ctx: Context, point: Point): string {
    const b = ctx.room.bounds;
    return `${Math.min(2, Math.floor(3 * (point.y - b.y) / b.height))}:${Math.min(2, Math.floor(3 * (point.x - b.x) / b.width))}`;
}
/** Keep high scoring choices while retaining candidates in other lobes/interior areas. */
function diverseChoices(ctx: Context, candidates: FurnishingPlacement[], limit: number): FurnishingPlacement[] {
    if (!ctx.options.spatialDiversity || candidates.length <= limit) return candidates.slice(0, limit);
    const buckets = new Map<string, FurnishingPlacement[]>();
    for (const candidate of candidates) {
        const id = spatialBucket(ctx, candidate), bucket = buckets.get(id) || []; bucket.push(candidate); buckets.set(id, bucket);
    }
    const result: FurnishingPlacement[] = [], used = new Set<string>();
    const add = (candidate: FurnishingPlacement) => { if (result.length < limit && !used.has(candidate.id)) { result.push(candidate); used.add(candidate.id); } };
    const groups = [...buckets.values()];
    for (const group of groups) add(group[0]);
    for (const candidate of candidates) { if (result.length >= Math.max(groups.length, Math.ceil(limit / 2))) break; add(candidate); }
    for (let i = 0; result.length < limit && groups.some(group => i < group.length); i++) {
        for (const group of groups) if (group[i]) add(group[i]);
    }
    return result;
}
export function generateFurnishingCandidates(prep: FurnishingPreparation, roomId: string, options: FurnishingEngineOptions = {},
    placed: FurnishingPlacementInput[] = [], catalogIds?: string[]): FurnishingCandidateResult {
    const setup = context(prep, roomId, options);
    if (!setup.ctx) return { candidates: [], diagnostics: setup.diagnostics, checks: 0, truncated: false };
    const canonical = canonicalPlaced(setup.ctx, placed);
    if (!canonical) return { candidates: [], diagnostics: [diagnostic('invalid-existing-plan', 'Existing proposed placements failed validation.', roomId)], checks: 0, truncated: false };
    const result = enumerate(setup.ctx, catalogIds ? new Set(catalogIds) : undefined, canonical, false);
    const eligible = [...setup.ctx.items.values()].some(item => (!catalogIds || catalogIds.includes(item.id)) &&
        item.variants.some(variant => setup.ctx!.variants.has(variantId(item.id, variant.orient))));
    return { ...result, diagnostics: [...setup.diagnostics,
        ...(!eligible ? [diagnostic('no-eligible-variants', 'No available compatible furniture variants match this candidate request.', roomId)] : []),
        ...(result.truncated ? [diagnostic('candidate-budget-exhausted', 'Candidate enumeration reached its deterministic work limit.', roomId)] : [])] };
}
function matches(item: FurnishingCatalogItem, request: FurnishingPlacementRequest): boolean {
    return (!request.role || item.role === request.role) && (!request.catalogIds || request.catalogIds.includes(item.id));
}
function matchesRelationship(ctx: Context, candidate: FurnishingPlacement, request: FurnishingPlacementRequest, placed: (FurnishingPlacement & { requestId: string })[]): boolean {
    if (!request.near) return true;
    const distance = (cells: Point[], target: Point[]) => {
        let minimum = Infinity;
        for (const a of cells) for (const b of target) minimum = Math.min(minimum, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
        return minimum;
    };
    const faces = (source: FurnishingPlacement, target: FurnishingPlacement): boolean => {
        const forward = { W: { x: 1, y: 0 }, N: { x: 0, y: 1 }, E: { x: -1, y: 0 }, S: { x: 0, y: -1 } }[source.orient];
        return source.footprint.some(a => target.footprint.some(b => {
            if (!(forward.x ? a.y === b.y && (b.x - a.x) * forward.x > 0 : a.x === b.x && (b.y - a.y) * forward.y > 0)) return false;
            let cell = a;
            for (let step = 0; step < request.near!.maxDistance + source.footprint.length + target.footprint.length; step++) {
                const next = { x: cell.x + forward.x, y: cell.y + forward.y }, edge = ctx.edges.get(edgeBetween(cell, next));
                if (!ctx.nav.cells.has(key(next)) || !edge || edge.wall || edge.opening) return false;
                if (next.x === b.x && next.y === b.y) return true;
                if (ctx.nav.baselineBlocked.has(key(next)) || placed.some(p => p.id !== source.id && p.id !== target.id &&
                    ctx.items.get(p.catalogId)!.role !== 'coffee-table' && p.blockedCells.some(point => key(point) === key(next)))) return false;
                cell = next;
            }
            return false;
        }));
    };
    const occupied = blocked(ctx, [...placed, candidate]);
    const approachesConnect = (target: FurnishingPlacement): boolean => {
        if (!candidate.accessCells.length || !target.accessCells.length) return true;
        const targets = new Set(target.accessCells.map(key)), visited = new Set<string>();
        let frontier = candidate.accessCells.filter(cell => !occupied.has(key(cell))).map(key);
        for (let step = 0; step <= request.near!.maxDistance + 2 && frontier.length; step++) {
            const next: string[] = [];
            for (const cell of frontier) {
                if (targets.has(cell)) return true;
                if (visited.has(cell)) continue;
                visited.add(cell);
                for (const neighbour of ctx.nav.neighbours.get(cell) || []) if (!visited.has(neighbour) && !occupied.has(neighbour)) next.push(neighbour);
            }
            frontier = next;
        }
        return false;
    };
    return placed.filter(p => p.requestId === request.near!.requestId || request.near!.extendRun && p.requestId === request.id).some(target => {
        const separation = distance(candidate.footprint, target.footprint);
        if (request.near!.sameFacing && candidate.orient !== target.orient) return false;
        return separation > 0 && separation <= request.near!.maxDistance && (!request.near!.faceTarget ||
            faces(candidate, target) && candidate.accessCells.length > 0 && distance(candidate.accessCells, target.footprint) < separation) &&
            (!request.near!.targetFacesCandidate || faces(target, candidate)) && approachesConnect(target);
    });
}
interface State { placements: (FurnishingPlacement & { requestId: string })[]; required: number; requiredPriority: number; optionalPriority: number; score: number; tie: number; }
function compareStates(a: State, b: State): number {
    return b.required - a.required || b.requiredPriority - a.requiredPriority || b.optionalPriority - a.optionalPriority ||
        b.placements.length - a.placements.length || b.score - a.score || a.tie - b.tie || compareText(a.placements.map(p => p.id).join('|'), b.placements.map(p => p.id).join('|'));
}
/** Bounded beam search over explicit goals. No document edits, built-in room recipes or object UID allocation. */
export function planFurnishingRoom(prep: FurnishingPreparation, roomId: string, requests: FurnishingPlacementRequest[], options: FurnishingEngineOptions = {}): FurnishingRoomPlan {
    const setup = context(prep, roomId, options), diagnostics = [...setup.diagnostics];
    const initial: FurnishingRoomPlan = { roomId, seed: String(options.seed ?? '0'), status: 'blocked', placements: [], unfilled: [...requests].sort((a, b) => compareText(a.id, b.id)).map(request => ({ requestId: request.id, count: request.count, required: request.required !== false })),
        requiredSatisfied: false, score: 0, diagnostics, stats: { candidateChecks: 0, searchChecks: 0, truncated: false } };
    const validRequests = requests.length <= 64 && new Set(requests.map(request => request.id)).size === requests.length && requests.every(request =>
        !!request.id && (!!request.role || !!request.catalogIds?.length) && Number.isSafeInteger(request.count) && request.count >= 0 && request.count <= 64 &&
        Number.isSafeInteger(request.priority ?? 1) && (request.priority ?? 1) >= 0 && (request.priority ?? 1) <= 1000 &&
        Number.isSafeInteger(request.order ?? 0) && (request.order ?? 0) >= 0 && (request.order ?? 0) <= 1000) && requests.reduce((sum, request) => sum + request.count, 0) <= 64;
    const pending = [...requests], ordered: FurnishingPlacementRequest[] = [];
    while (pending.length) {
        const index = pending.findIndex(request => !request.near || ordered.some(target => target.id === request.near!.requestId));
        if (index < 0) break;
        ordered.push(...pending.splice(index, 1));
    }
    const validRelationships = !pending.length && requests.every(request => !request.near ||
        Number.isSafeInteger(request.near.maxDistance) && request.near.maxDistance >= 1 && request.near.maxDistance <= 4096 &&
        (['faceTarget', 'targetFacesCandidate', 'sameFacing', 'extendRun'] as const).every(name => request.near![name] === undefined || typeof request.near![name] === 'boolean'));
    if (!validRequests || !validRelationships) { diagnostics.push(diagnostic('invalid-placement-requests', 'Use unique request IDs, explicit roles/items, non-negative counts/priorities and at most 64 placements. Relationships must reference another request without cycles.', roomId)); return initial; }
    if (!setup.ctx) return initial;
    const ctx = setup.ctx;
    const requestsById = new Map(requests.map(request => [request.id, request]));
    for (const request of requests.filter(request => request.count)) {
        if (![...ctx.items.values()].some(item => matches(item, request) && item.variants.some(variant => ctx.variants.has(variantId(item.id, variant.orient))))) {
            diagnostics.push(diagnostic('no-eligible-variants', `No available compatible furniture variants match ${request.id}.`, roomId));
        }
    }
    const allowed = new Set([...ctx.items.values()].filter(item => requests.some(request => request.count && matches(item, request))).map(item => item.id));
    const pool = enumerate(ctx, allowed, [], true);
    initial.stats.candidateChecks = pool.checks; initial.stats.truncated = pool.truncated;
    if (pool.truncated) diagnostics.push(diagnostic('candidate-budget-exhausted', 'Candidate enumeration reached its deterministic work limit.', roomId));
    const stage = (request: FurnishingPlacementRequest) => [...allowed].filter(id => matches(ctx.items.get(id)!, request)).every(id => ctx.items.get(id)!.support === 'surface') ? 1 : 0;
    // Sort by the normal objective, then honor recipe dependencies without changing tie order.
    const sorted = [...requests].sort((a, b) => stage(a) - stage(b) || (a.order ?? 0) - (b.order ?? 0) || Number(b.required !== false) - Number(a.required !== false) || (b.priority ?? 1) - (a.priority ?? 1) || compareText(a.id, b.id));
    ordered.length = 0;
    while (sorted.length) {
        const index = sorted.findIndex(request => !request.near || ordered.some(target => target.id === request.near!.requestId));
        ordered.push(...sorted.splice(index, 1));
    }
    let beam: State[] = [{ placements: [], required: 0, requiredPriority: 0, optionalPriority: 0, score: 0, tie: 0 }], best = beam[0];
    outer: for (const request of ordered) for (let slot = 0; slot < request.count; slot++) {
        const next: State[] = [], skipped: State[] = [];
        for (const state of beam) {
            next.push(state); skipped.push(state);
            let attempts = 0;
            let exhausted = false;
            const choices: FurnishingPlacement[] = [];
            const eligible = pool.candidates.filter(candidate => matches(ctx.items.get(candidate.catalogId)!, request));
            // The candidate window itself must cover more than the highest-scoring corner.
            for (const candidate of ctx.options.spatialDiversity ? diverseChoices(ctx, eligible, ctx.options.candidatesPerState) : eligible) {
                if (!ctx.options.spatialDiversity && !matchesRelationship(ctx, candidate, request, state.placements)) continue;
                if (attempts++ >= ctx.options.candidatesPerState) break;
                if (initial.stats.searchChecks >= ctx.options.maxSearchChecks) {
                    initial.stats.truncated = true;
                    diagnostics.push(diagnostic('search-budget-exhausted', 'Layout search reached its deterministic work limit.', roomId));
                    exhausted = true; break;
                }
                initial.stats.searchChecks++;
                if (ctx.options.spatialDiversity && !matchesRelationship(ctx, candidate, request, state.placements)) continue;
                const result = evaluate(ctx, candidate, state.placements);
                if (result.valid) {
                    const proposed = [...state.placements, { ...result.placement!, requestId: request.id }];
                    // New objects must preserve relationships of earlier objects, including their sight lines.
                    if (proposed.every(p => matchesRelationship(ctx, p, requestsById.get(p.requestId)!, proposed.filter(other => other.id !== p.id))))
                        choices.push(result.placement!);
                }
            }
            for (const candidate of diverseChoices(ctx, choices.sort((a, b) => compareCandidates(ctx, a, b)), ctx.options.branchesPerState)) {
                const placements = [...state.placements, { ...candidate, requestId: request.id }];
                const scored = placements.map(placement => ({ ...placement, score: scoring(ctx, placement, placements) }));
                next.push({ placements: scored, required: state.required + Number(request.required !== false),
                    requiredPriority: state.requiredPriority + (request.required !== false ? request.priority ?? 1 : 0),
                    optionalPriority: state.optionalPriority + (request.required === false ? request.priority ?? 1 : 0), score: scored.reduce((sum, p) => sum + p.score.total, 0),
                    tie: scored.reduce((sum, placement) => sum + tie(ctx, placement), 0) });
            }
            if (exhausted) { beam = [...next, ...beam].sort(compareStates).slice(0, ctx.options.beamWidth); break outer; }
        }
        const unique = new Map<string, State>();
        for (const state of next.sort(compareStates)) {
            const key = state.placements.map(p => `${p.requestId}:${p.id}`).sort().join('|'); if (!unique.has(key)) unique.set(key, state);
        }
        beam = [...unique.values()].slice(0, ctx.options.beamWidth);
        // Retain a skip branch so bounded backtracking can sacrifice an earlier placement to fit later goals.
        const skip = skipped.sort(compareStates)[0];
        if (ctx.options.beamWidth > 1 && skip && !beam.includes(skip)) beam = [...beam.slice(0, ctx.options.beamWidth - 1), skip];
        best = [...beam, best].sort(compareStates)[0];
    }
    best = [...beam, best].sort(compareStates)[0];
    const unfilled = [...requests].sort((a, b) => compareText(a.id, b.id)).map(request => ({ requestId: request.id, required: request.required !== false,
        count: request.count - best.placements.filter(placement => placement.requestId === request.id).length })).filter(request => request.count > 0);
    for (const missing of unfilled) diagnostics.push(diagnostic('unfilled-request', `${missing.count} placement(s) remain for ${missing.requestId}. No invalid placement was forced.`, roomId));
    return { ...initial, status: unfilled.length ? 'partial' : 'complete', placements: best.placements, unfilled,
        requiredSatisfied: unfilled.every(request => !request.required), score: best.score };
}
