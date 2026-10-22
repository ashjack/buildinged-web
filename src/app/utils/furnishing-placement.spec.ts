import { of } from 'rxjs';
import { FurnishingPlacementInput, FurnishingPlacementRequest } from '../models/auto-furnishing.models';
import { AutoFurnishingAnalysisService } from '../services/auto-furnishing-analysis.service';
import { AutoFurnishingPlacementService } from '../services/auto-furnishing-placement.service';
import { furnishingBuilding, furnishingItem, furnishingPreparation } from '../testing/furnishing-fixtures';
import { emptyIndexGrid, writeIndexGrid } from './tbx-grid';
import { writeBuildingFile } from './tbx-format';
import { furnishingCellKey as key } from './furnishing-room-analysis';
import { generateFurnishingCandidates, planFurnishingRoom, validateFurnishingPlacement } from './furnishing-placement';

function input(catalogId: string, x: number, y: number): FurnishingPlacementInput { return { catalogId, x, y, orient: 'W' }; }
function freeze(value: any): void {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    Object.freeze(value); Object.values(value).forEach(freeze);
}
describe('Deterministic furnishing placement engine', () => {
    it('shares truncated spatial enumeration across furniture roles and room areas deterministically', () => {
        const prep = furnishingPreparation(furnishingBuilding(Array.from({ length: 20 }, () => Array(20).fill(1))),
            [furnishingItem('a'), furnishingItem('b')]), room = prep.analysis.rooms[0];
        const options = { spatialDiversity: true, maxCandidateChecks: 8 };
        const first = generateFurnishingCandidates(prep, room.id, options);
        expect(first.checks).toBe(8); expect(first.truncated).toBeTrue();
        expect(new Set(first.candidates.map(p => p.catalogId)).size).toBe(2);
        expect(new Set(first.candidates.map(p => `${Math.floor(p.x / 7)}:${Math.floor(p.y / 7)}`)).size).toBeGreaterThan(1);
        prep.catalog.items.reverse(); prep.analysis.rooms[0].cells.reverse(); prep.analysis.edges.reverse();
        expect(generateFurnishingCandidates(prep, room.id, options)).toEqual(first);
        expect(planFurnishingRoom(prep, room.id, [{ id: 'a', role: 'a', count: 1 }], { spatialDiversity: 'bad' as any }).status).toBe('blocked');
    });
    it('keeps required furniture ahead in the objective even when a recipe explores optional pieces first', () => {
        const prep = furnishingPreparation(furnishingBuilding([[1, 1]])), id = prep.analysis.rooms[0].id;
        const plan = planFurnishingRoom(prep, id, [
            { id: 'optional', role: 'crate', count: 1, required: false, order: 0, priority: 1000 },
            { id: 'required', role: 'crate', count: 1, order: 1 }
        ], { spatialDiversity: true });
        expect(plan.placements.map(p => p.requestId)).toEqual(['required']); expect(plan.requiredSatisfied).toBeTrue();
    });
    it('extends a continuous counter run beyond its first counter with a consistent native facing', () => {
        const sink = furnishingItem('sink', { wall: true, access: [{ x: 1, y: 0 }] }), counter = furnishingItem('counter', { wall: true, access: [{ x: 1, y: 0 }] });
        const prep = furnishingPreparation(furnishingBuilding(), [sink, counter]), id = prep.analysis.rooms[0].id;
        const plan = planFurnishingRoom(prep, id, [
            { id: 'sink', role: 'sink', count: 1, priority: 10 },
            { id: 'counter', role: 'counter', count: 1, near: { requestId: 'sink', maxDistance: 1, sameFacing: true } },
            { id: 'extra', role: 'counter', count: 2, required: false, near: { requestId: 'counter', maxDistance: 1, sameFacing: true, extendRun: true } }
        ], { spatialDiversity: true });
        expect(plan.status).toBe('complete'); expect(plan.placements.length).toBe(4);
        expect(plan.placements.every(p => p.x === 0 && p.orient === 'W')).toBeTrue();
        const ys = plan.placements.map(p => p.y).sort((a, b) => a - b);
        expect(ys[3] - ys[0]).toBe(3);
    });
    it('does not aim furniture through a partial wall even when both sides are reachable around it', () => {
        const building = furnishingBuilding(Array.from({ length: 6 }, () => Array(7).fill(1)));
        building.floors[0].objects.push({ uid: 'divider', type: 'wall', x: 3, y: 0, length: 5, dir: 'N', Tile: 1, InteriorTile: 1 });
        const table = furnishingItem('table', { wall: true }), chair = furnishingItem('chair', { access: [{ x: -1, y: 0 }] });
        chair.definition.entries[0].orient = 'E'; chair.variants[0].orient = 'E'; chair.variants[0].wallEdges = [{ x: 0, y: 0, side: 'E' }];
        const prep = furnishingPreparation(building, [table, chair, furnishingItem('crate')]), id = prep.analysis.rooms[0].id;
        expect(prep.analysis.rooms.length).toBe(1);
        const plan = planFurnishingRoom(prep, id, [
            { id: 'table', role: 'table', count: 1 },
            { id: 'chair', role: 'chair', count: 1, near: { requestId: 'table', maxDistance: 6, faceTarget: true } },
            { id: 'crates', role: 'crate', count: 8, required: false }
        ], { spatialDiversity: true });
        expect(plan.status).toBe('complete');
        const tablePlacement = plan.placements.find(p => p.requestId === 'table')!, chairPlacement = plan.placements.find(p => p.requestId === 'chair')!;
        expect(tablePlacement.y).toBe(chairPlacement.y);
        for (let x = tablePlacement.x + 1; x <= chairPlacement.x; x++) {
            const edge = prep.analysis.edges.find(edge => edge.x === x && edge.y === tablePlacement.y && edge.axis === 'W')!;
            expect(edge.wall || !!edge.opening).toBeFalse();
        }
        expect(plan.placements.filter(p => p.requestId === 'crates').every(p => p.y !== tablePlacement.y || p.x <= tablePlacement.x || p.x >= chairPlacement.x)).toBeTrue();
    });
    it('enumerates stable, scored proposals with no edits, UIDs or Math.random calls', () => {
        const building = furnishingBuilding(), prep = furnishingPreparation(building), room = prep.analysis.rooms[0];
        const before = new XMLSerializer().serializeToString(writeBuildingFile(building)); freeze(prep); freeze(building);
        spyOn(Math, 'random').and.throwError('Unseeded randomness');
        const first = generateFurnishingCandidates(prep, room.id, { seed: 'house-42' });
        expect(first.candidates.length).toBeGreaterThan(10);
        expect(generateFurnishingCandidates(prep, room.id, { seed: 'house-42' })).toEqual(first);
        expect(first.candidates.every(candidate => candidate.roomId === room.id && candidate.level === 0 && candidate.score.total > 0)).toBeTrue();
        const requests = [{ id: 'crate', role: 'crate', count: 2 }]; freeze(requests);
        const plan = planFurnishingRoom(prep, room.id, requests, { seed: 'house-42' });
        expect(plan.status).toBe('complete');
        expect(planFurnishingRoom(prep, room.id, requests, { seed: 'house-42' })).toEqual(plan);
        expect(new XMLSerializer().serializeToString(writeBuildingFile(building))).toBe(before);
    });
    it('changes tied choices with the seed and is independent of catalog, availability and room-cell ordering', () => {
        const prep = furnishingPreparation(furnishingBuilding(), [furnishingItem('crate'), furnishingItem('table')]);
        const id = prep.analysis.rooms[0].id, requests = [{ id: 'one', catalogIds: ['crate'], count: 1 }];
        const plans = Array.from({ length: 12 }, (_, seed) => planFurnishingRoom(prep, id, requests, { seed }));
        expect(new Set(plans.map(plan => plan.placements[0].id)).size).toBeGreaterThan(1);
        const before = generateFurnishingCandidates(prep, id, { seed: 42 });
        prep.catalog.items.reverse(); prep.availability.reverse(); prep.analysis.rooms[0].cells.reverse(); prep.analysis.edges.reverse();
        expect(generateFurnishingCandidates(prep, id, { seed: 42 })).toEqual(before);
    });
    it('fits exact irregular room cells instead of the bounding rectangle', () => {
        const prep = furnishingPreparation(furnishingBuilding([[1, 1, 1], [1, 0, 0], [1, 1, 1]]), [furnishingItem('wide', { width: 2 })]);
        const id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('wide', 0, 1)).reasons).toContain('outside-room');
        const membership = new Set(prep.analysis.rooms[0].cells.map(key));
        expect(generateFurnishingCandidates(prep, id).candidates.every(candidate => candidate.footprint.every(cell => membership.has(key(cell))))).toBeTrue();
    });
    it('rejects wall crossings and clearances separated from furniture by a wall', () => {
        const building = furnishingBuilding();
        building.floors[0].objects.push({ uid: 'wall', type: 'wall', x: 2, y: 1, length: 3, dir: 'N', Tile: 1, InteriorTile: 1 });
        const prep = furnishingPreparation(building, [furnishingItem('wide', { width: 2 }), furnishingItem('cabinet', { access: [{ x: 1, y: 0 }] })]);
        const id = prep.analysis.rooms[0].id;
        expect(prep.analysis.rooms.length).toBe(1);
        expect(validateFurnishingPlacement(prep, id, input('wide', 1, 1)).reasons).toContain('crosses-wall-or-opening');
        expect(validateFurnishingPlacement(prep, id, input('cabinet', 1, 2)).reasons).toContain('clearance-separated-by-wall');
    });
    it('requires wall anchors, refuses windows as anchors, and protects entry approach cells', () => {
        const building = furnishingBuilding();
        building.floors[0].objects.push({ uid: 'window', type: 'window', x: 0, y: 3, dir: 'W', Tile: 0 });
        const prep = furnishingPreparation(building, [furnishingItem('sink', { wall: true, access: [{ x: 1, y: 0 }] })]);
        const id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('sink', 2, 2)).reasons).toContain('wall-anchor-missing');
        expect(validateFurnishingPlacement(prep, id, input('sink', 0, 3)).reasons).toContain('wall-anchor-missing');
        expect(validateFurnishingPlacement(prep, id, input('sink', 0, 0)).reasons).toContain('reserved-footprint');
        expect(validateFurnishingPlacement(prep, id, input('sink', 0, 2)).valid).toBeTrue();
    });
    it('preserves existing furniture and both existing and newly requested access clearances', () => {
        const building = furnishingBuilding(), cabinet = furnishingItem('cabinet', { access: [{ x: 1, y: 0 }] });
        building.furniture = [cabinet.definition];
        building.floors[0].objects.push({ uid: 'cabinet', type: 'furniture', x: 1, y: 1, orient: 'W', FurnitureTiles: 0 });
        const prep = furnishingPreparation(building, [cabinet, furnishingItem('crate')]), id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('crate', 1, 1)).reasons).toContain('furniture-overlap');
        expect(validateFurnishingPlacement(prep, id, input('crate', 2, 1)).reasons).toContain('clearance-blocked');
        expect(validateFurnishingPlacement(prep, id, input('cabinet', 0, 1)).reasons).toContain('clearance-blocked');
        expect(validateFurnishingPlacement(prep, id, input('crate', 3, 3), [input('cabinet', 2, 3)]).reasons).toContain('clearance-blocked');
    });
    it('rejects a bottleneck blockage even when no furniture clearance is directly occupied', () => {
        const building = furnishingBuilding([[1, 1, 1, 0, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 0, 1, 1, 1]]);
        building.floors[0].objects.push({ uid: 'other-entry', type: 'door', x: 7, y: 1, dir: 'W', Tile: 0 });
        const prep = furnishingPreparation(building), id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('crate', 3, 1)).reasons).toContain('connectivity-split');
        expect(validateFurnishingPlacement(prep, id, input('crate', 6, 0)).valid).toBeTrue();
    });
    it('does not require repairing pre-existing disconnections, but refuses new furniture in unreachable areas', () => {
        const building = furnishingBuilding([[1, 1, 1, 0, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 0, 1, 1, 1]]);
        building.user_tiles = [{ tile: 'manual_000' }]; const grid = emptyIndexGrid(8, 4); grid[1][3] = 1;
        building.floors[0].tileLayers = [{ layer: 'Furniture', tiles: writeIndexGrid(grid) }];
        let prep = furnishingPreparation(building), id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('crate', 6, 0)).reasons).toContain('placement-unreachable');
        building.floors[0].objects.push({ uid: 'other-entry', type: 'door', x: 7, y: 1, dir: 'W', Tile: 0 });
        prep = furnishingPreparation(building); id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('crate', 6, 0)).valid).toBeTrue();
    });
    it('keeps stair treads, upper landings and floor holes reserved', () => {
        const building = furnishingBuilding(); building.floors.push({ ...building.floors[0], objects: [{ uid: 'upper-entry', type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 }] });
        building.floors[0].objects.push({ uid: 'stairs', type: 'stairs', x: 0, y: 2, dir: 'W', Tile: 0 });
        const prep = furnishingPreparation(building);
        for (const room of prep.analysis.rooms) expect(validateFurnishingPlacement(prep, room.id, input('crate', 4, 2)).reasons).toContain('reserved-footprint');
        expect(validateFurnishingPlacement(prep, prep.analysis.rooms[1].id, input('crate', 2, 2)).reasons).toContain('reserved-footprint');
    });
    it('does not use a stair tread as an interaction clearance cell', () => {
        const building = furnishingBuilding();
        building.floors[0].objects.push({ uid: 'stairs', type: 'stairs', x: 0, y: 2, dir: 'W', Tile: 0 });
        const prep = furnishingPreparation(building, [furnishingItem('cabinet', { access: [{ x: 0, y: 1 }] })]);
        expect(validateFurnishingPlacement(prep, prep.analysis.rooms[0].id, input('cabinet', 2, 1)).reasons).toContain('clearance-on-stairs');
    });
    it('permits a non-blocking rug beneath furniture while prohibiting same-layer overlaps', () => {
        const building = furnishingBuilding(), crate = furnishingItem('crate'), rug = furnishingItem('rug', { blocks: false, layer: 'FloorFurniture' });
        building.furniture = [crate.definition]; building.floors[0].objects.push({ uid: 'crate', type: 'furniture', x: 1, y: 1, orient: 'W', FurnitureTiles: 0 });
        let prep = furnishingPreparation(building, [crate, rug]), id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('rug', 1, 1)).valid).toBeTrue();
        expect(validateFurnishingPlacement(prep, id, input('rug', 2, 2), [input('rug', 2, 2)]).valid).toBeFalse();
        building.furniture = [rug.definition];
        prep = furnishingPreparation(building, [crate, rug]); id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('crate', 1, 1)).valid).toBeTrue();
    });
    it('requires a complete support surface for a surface item and records an existing host UID', () => {
        const building = furnishingBuilding(), counter = furnishingItem('counter', { surface: true }), micro = furnishingItem('microwave', { support: 'surface', blocks: false, access: [{ x: 1, y: 0 }] });
        let prep = furnishingPreparation(building, [counter, micro]), id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('microwave', 0, 2)).reasons).toContain('support-surface-missing');
        building.furniture = [counter.definition]; building.floors[0].objects.push({ uid: 'counter', type: 'furniture', x: 0, y: 2, orient: 'W', FurnitureTiles: 0 });
        prep = furnishingPreparation(building, [counter, micro]); id = prep.analysis.rooms[0].id;
        const placement = validateFurnishingPlacement(prep, id, input('microwave', 0, 2));
        expect(placement.valid).toBeTrue(); expect(placement.placement?.supportId).toBe('existing:counter');
    });
    it('orders proposed supports before their dependants and uses the proposed support identity', () => {
        const items = [furnishingItem('counter', { surface: true }), furnishingItem('microwave', { support: 'surface', blocks: false })];
        const prep = furnishingPreparation(furnishingBuilding(), items), id = prep.analysis.rooms[0].id;
        const plan = planFurnishingRoom(prep, id, [{ id: 'microwave', role: 'microwave', count: 1, priority: 100 }, { id: 'counter', role: 'counter', count: 1 }]);
        expect(plan.status).toBe('complete');
        expect(plan.placements.find(p => p.catalogId === 'microwave')?.supportId).toBe(plan.placements.find(p => p.catalogId === 'counter')?.id);
    });
    it('never invents orientations or uses unavailable assets', () => {
        const prep = furnishingPreparation(furnishingBuilding()), id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, { ...input('crate', 1, 1), orient: 'N' }).valid).toBeFalse();
        prep.availability[0].available = false;
        expect(generateFurnishingCandidates(prep, id).candidates).toEqual([]);
        expect(planFurnishingRoom(prep, id, [{ id: 'crate', role: 'crate', count: 1 }]).unfilled[0].count).toBe(1);
    });
    it('honors explicit coverage and style preferences through visible score components', () => {
        const prep = furnishingPreparation(furnishingBuilding(), [furnishingItem('red', { style: 'red', role: 'chair' }), furnishingItem('blue', { style: 'blue', role: 'chair' })]);
        const id = prep.analysis.rooms[0].id;
        expect(validateFurnishingPlacement(prep, id, input('red', 1, 1), [], { maxCoverage: 0 }).reasons).toContain('coverage-limit');
        const result = generateFurnishingCandidates(prep, id, { style: 'red' });
        expect(result.candidates[0].catalogId).toBe('red'); expect(result.candidates[0].score.style).toBe(20);
        expect(result.candidates[0].score.total).toBe(Object.entries(result.candidates[0].score).filter(([name]) => name !== 'total').reduce((sum, [, value]) => sum + value, 0));
    });
    it('returns a valid partial layout when requests do not fit and marks missing required goals', () => {
        const prep = furnishingPreparation(furnishingBuilding([[1, 1], [1, 1]])), id = prep.analysis.rooms[0].id;
        const plan = planFurnishingRoom(prep, id, [{ id: 'crates', role: 'crate', count: 10 }]);
        expect(plan.status).toBe('partial'); expect(plan.requiredSatisfied).toBeFalse(); expect(plan.placements.length).toBe(3);
        expect(plan.unfilled).toEqual([{ requestId: 'crates', count: 7, required: true }]);
        const prefix: FurnishingPlacementInput[] = [];
        for (const placement of plan.placements) { expect(validateFurnishingPlacement(prep, id, placement, prefix).valid).toBeTrue(); prefix.push(placement); }
    });
    it('retains skip branches to recover a better partial layout instead of committing greedily', () => {
        const prep = furnishingPreparation(furnishingBuilding([[1, 1], [1, 1]]), [furnishingItem('wide', { width: 2 }), furnishingItem('small')]);
        const plan = planFurnishingRoom(prep, prep.analysis.rooms[0].id, [{ id: 'a-wide', role: 'wide', count: 1 }, { id: 'b-small', role: 'small', count: 3 }]);
        expect(plan.placements.length).toBe(3); expect(plan.placements.every(p => p.catalogId === 'small')).toBeTrue();
        expect(plan.unfilled).toEqual([{ requestId: 'a-wide', count: 1, required: true }]);
    });
    it('enforces deterministic candidate/search budgets and preserves work found before exhaustion', () => {
        const prep = furnishingPreparation(furnishingBuilding()), id = prep.analysis.rooms[0].id, requests = [{ id: 'crate', role: 'crate', count: 2 }];
        const limited = generateFurnishingCandidates(prep, id, { maxCandidateChecks: 1 });
        expect(limited.checks).toBe(1); expect(limited.truncated).toBeTrue();
        const plan = planFurnishingRoom(prep, id, requests, { maxSearchChecks: 1 });
        expect(plan.stats.searchChecks).toBe(1); expect(plan.stats.truncated).toBeTrue(); expect(plan.placements.length).toBe(1);
        expect(planFurnishingRoom(prep, id, requests, { maxSearchChecks: 1 })).toEqual(plan);
    });
    it('requires analysis review, allows a room type override, and handles malformed options/requests', () => {
        const building = furnishingBuilding(); building.rooms[0].InternalName = building.rooms[0].Name = 'custom';
        const prep = furnishingPreparation(building), id = prep.analysis.rooms[0].id;
        expect(generateFurnishingCandidates(prep, id).diagnostics[0].code).toBe('unknown-room-type');
        expect(generateFurnishingCandidates(prep, id, { roomType: 'bedroom' }).candidates.length).toBeGreaterThan(0);
        expect(planFurnishingRoom(prep, id, [{ id: 'bad', role: 'crate', count: 1000 }]).status).toBe('blocked');
        expect(generateFurnishingCandidates(prep, id, { maxCandidateChecks: NaN }).diagnostics[0].code).toBe('invalid-engine-options');
        expect(generateFurnishingCandidates(prep, 'missing').diagnostics[0].code).toBe('room-not-found');
    });
    it('re-derives proposal masks and refuses invalid prior proposals rather than trusting caller fields', () => {
        const prep = furnishingPreparation(furnishingBuilding()), id = prep.analysis.rooms[0].id;
        const forged = { ...input('crate', 0, 0), footprint: [], blockedCells: [], accessCells: [] };
        expect(validateFurnishingPlacement(prep, id, forged).reasons).toContain('reserved-footprint');
        expect(validateFurnishingPlacement(prep, id, input('crate', 2, 2), [forged]).reasons).toContain('invalid-existing-plan');
        const forgedHost = { ...input('crate', 2, 2), supportId: 'forged-host' };
        expect(validateFurnishingPlacement(prep, id, forgedHost).placement?.supportId).toBeUndefined();
    });
    it('excludes malformed catalog masks and duplicate orientations instead of planning mismatched sprites', () => {
        const item = furnishingItem('wide', { width: 2 }), prep = furnishingPreparation(furnishingBuilding(), [item]);
        item.variants[0].footprint = [{ x: 0, y: 0 }];
        let result = generateFurnishingCandidates(prep, prep.analysis.rooms[0].id);
        expect(result.candidates).toEqual([]); expect(result.diagnostics.some(d => d.code === 'invalid-catalog-variant')).toBeTrue();
        const valid = furnishingItem('duplicate'); valid.variants.push({ ...valid.variants[0] });
        const duplicate = furnishingPreparation(furnishingBuilding(), [valid]);
        result = generateFurnishingCandidates(duplicate, duplicate.analysis.rooms[0].id);
        expect(result.candidates).toEqual([]);
    });
    it('never trades a required placement for a higher-priority optional placement', () => {
        const prep = furnishingPreparation(furnishingBuilding([[1, 1]]));
        const plan = planFurnishingRoom(prep, prep.analysis.rooms[0].id, [
            { id: 'required', role: 'crate', count: 1 }, { id: 'optional', role: 'crate', count: 1, required: false, priority: 1000 }
        ]);
        expect(plan.requiredSatisfied).toBeTrue();
        expect(plan.placements.map(placement => placement.requestId)).toEqual(['required']);
    });
    it('handles zero-count and optional goals without claiming required furniture is missing', () => {
        const prep = furnishingPreparation(furnishingBuilding([[1, 1], [1, 1]])), id = prep.analysis.rooms[0].id;
        expect(planFurnishingRoom(prep, id, [{ id: 'zero', role: 'crate', count: 0 }]).status).toBe('complete');
        const plan = planFurnishingRoom(prep, id, [{ id: 'optional', role: 'crate', count: 10, required: false }]);
        expect(plan.status).toBe('partial'); expect(plan.requiredSatisfied).toBeTrue();
    });
    it('honors recipe dependencies and never places dependent chairs without their table', () => {
        const prep = furnishingPreparation(furnishingBuilding(), [furnishingItem('table'), furnishingItem('chair', { access: [{ x: 1, y: 0 }] })]);
        const id = prep.analysis.rooms[0].id;
        const requests: FurnishingPlacementRequest[] = [
            { id: 'chairs', role: 'chair', count: 1, priority: 100, near: { requestId: 'table', maxDistance: 2, faceTarget: true } },
            { id: 'table', role: 'table', count: 1, priority: 1 }
        ];
        const plan = planFurnishingRoom(prep, id, requests);
        expect(plan.status).toBe('complete'); expect(plan.placements[0].requestId).toBe('table');
        const table = plan.placements[0];
        for (const chair of plan.placements.slice(1)) {
            expect(table.x - chair.x).toBe(2); expect(table.y).toBe(chair.y);
        }
        prep.availability.find(item => item.catalogId === 'table')!.available = false;
        expect(planFurnishingRoom(prep, id, requests).placements).toEqual([]);
    });
    it('rejects cyclic, missing and invalid-distance recipe relationships', () => {
        const prep = furnishingPreparation(furnishingBuilding()), id = prep.analysis.rooms[0].id;
        for (const near of [{ requestId: 'one', maxDistance: 2 }, { requestId: 'missing', maxDistance: 2 }, { requestId: 'target', maxDistance: 0 }]) {
            const plan = planFurnishingRoom(prep, id, [{ id: 'one', role: 'crate', count: 1, near }, { id: 'target', role: 'crate', count: 1 }]);
            expect(plan.status).toBe('blocked'); expect(plan.diagnostics.some(d => d.code === 'invalid-placement-requests')).toBeTrue();
        }
        const cycle = planFurnishingRoom(prep, id, [
            { id: 'a', role: 'crate', count: 1, near: { requestId: 'b', maxDistance: 2 } },
            { id: 'b', role: 'crate', count: 1, near: { requestId: 'a', maxDistance: 2 } }
        ]);
        expect(cycle.status).toBe('blocked');
    });
    it('plans multiple rooms independently of request order without changing the document', async () => {
        const building = furnishingBuilding(); building.floors.push({ ...building.floors[0], objects: [{ uid: 'upper-entry', type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 }] });
        const prep = furnishingPreparation(building), prepare = jasmine.createSpy('prepare').and.resolveTo(prep);
        const service = new AutoFurnishingPlacementService({ prepare } as any);
        const rooms = prep.analysis.rooms.map(room => ({ roomId: room.id, requests: [{ id: 'one', role: 'crate', count: 1 }] }));
        const before = JSON.stringify(building), first = await service.plan(building, rooms, { seed: 'building' });
        expect((await service.plan(building, [...rooms].reverse(), { seed: 'building' })).plans).toEqual(first.plans);
        expect((await service.plan(building, [rooms[0]], { seed: 'building' })).plans[0]).toEqual(first.plans[0]);
        expect(JSON.stringify(building)).toBe(before);
        await expectAsync(service.plan(building, [rooms[0], rooms[0]])).toBeRejectedWithError(/once/);
    });
});

describe('Native furnishing catalog placement integration', () => {
    let source: string;
    beforeAll(async () => source = await (await fetch('/assets/BuildingFurniture.txt')).text());
    it('plans real native bed/chair variants from the preparation service and validates the final layout', async () => {
        const analysis = new AutoFurnishingAnalysisService({ get: () => of(source) } as any, { getTile: async () => ({}) } as any);
        const building = furnishingBuilding(), prep = await analysis.prepare(building), room = prep.analysis.rooms[0];
        const requests: FurnishingPlacementRequest[] = [{ id: 'bed', role: 'bed', count: 1 }, { id: 'chair', role: 'chair', count: 1 }];
        const plan = planFurnishingRoom(prep, room.id, requests, { seed: 'native-bedroom' });
        expect(plan.status).toBe('complete'); expect(plan.placements.length).toBe(2);
        const prefix: FurnishingPlacementInput[] = [];
        for (const placement of plan.placements) {
            const catalog = prep.catalog.items.find(item => item.id === placement.catalogId)!;
            expect(catalog.definition.entries.some(entry => entry.orient === placement.orient)).toBeTrue();
            expect(validateFurnishingPlacement(prep, room.id, placement, prefix).valid).toBeTrue(); prefix.push(placement);
        }
        expect(building.floors[0].objects.length).toBe(1);
    });
});
