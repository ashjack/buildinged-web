import { of } from 'rxjs';
import { ApplyFurnishing, EditRooms, Redo, SetBuilding, Undo } from '../app.actions';
import { furnishingBuilding } from '../testing/furnishing-fixtures';
import { documentHarness } from '../testing/document-harness';
import { writeIndexGrid } from '../utils/tbx-grid';
import { furnishingRoomReason, FURNISHING_RECIPES } from '../utils/furnishing-recipes';
import { validateFurnishingPlacement } from '../utils/furnishing-placement';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { AutoFurnishingAnalysisService } from './auto-furnishing-analysis.service';
import { AutoFurnishingService } from './auto-furnishing.service';

describe('First usable auto furnishing workflow', () => {
    let source: string;
    let h: ReturnType<typeof documentHarness>;
    let service: AutoFurnishingService;
    let available: boolean;
    beforeAll(async () => source = await (await fetch('/assets/BuildingFurniture.txt')).text());
    beforeEach(() => {
        const building = furnishingBuilding(), base = building.rooms[0];
        building.rooms = ['bedroom', 'bathroom', 'diningroom'].map(name => ({ ...base, Name: name, InternalName: name }));
        building.floors = building.rooms.map((_, level) => ({
            rooms: writeIndexGrid(Array.from({ length: 6 }, () => Array(6).fill(level + 1))),
            objects: [{ uid: `door-${level}`, type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 }]
        }));
        h = documentHarness(building); available = true;
        const analysis = new AutoFurnishingAnalysisService({ get: () => of(source) } as any,
            { getTile: async () => available ? {} : undefined } as any);
        service = new AutoFurnishingService(analysis, h.store as any);
    });
    afterEach(() => h.destroy());

    it('previews the three native room recipes without changing the document or history', async () => {
        const session = await service.inspect(), before = JSON.stringify(session.building);
        const preview = await service.generate(session, session.preparation.analysis.rooms.map(room => room.id), 'release-1');
        expect(preview.plans.length).toBe(3);
        for (const plan of preview.plans) {
            expect(plan.status).withContext(plan.roomId + JSON.stringify(plan.unfilled)).toBe('complete');
            const prefix: typeof plan.placements = [];
            for (const placement of plan.placements) {
                expect(validateFurnishingPlacement(preview.preparation, plan.roomId, placement, prefix, { maxCoverage: .55 }).valid).toBeTrue();
                prefix.push(placement);
            }
        }
        const dining = preview.plans.find(plan => plan.placements.some(p => p.requestId === 'table'))!;
        const table = dining.placements.find(p => p.requestId === 'table')!;
        expect(dining.placements.filter(p => p.requestId === 'chairs').length).toBe(2);
        for (const chair of dining.placements.filter(p => p.requestId === 'chairs')) {
            const distance = (cells: { x: number; y: number }[]) => Math.min(...cells.flatMap(a => table.footprint.map(b => Math.abs(a.x - b.x) + Math.abs(a.y - b.y))));
            expect(distance(chair.footprint)).toBeLessThanOrEqual(2);
            expect(distance(chair.accessCells)).toBeLessThan(distance(chair.footprint));
        }
        expect(JSON.stringify(h.state.value.building)).toBe(before); expect(h.state.value.past.length).toBe(0);
    });
    it('regenerates reproducibly and keeps room order independent', async () => {
        const session = await service.inspect(), ids = session.preparation.analysis.rooms.map(room => room.id);
        const first = await service.generate(session, ids, '1');
        expect((await service.generate(session, [...ids].reverse(), '1')).plans).toEqual(first.plans);
        const variations = await Promise.all(['2', '3'].map(seed => service.generate(session, [ids[0]], seed)));
        expect(variations.some(p => JSON.stringify(p.plans[0].placements) !== JSON.stringify(first.plans[0].placements))).toBeTrue();
        expect(h.state.value.past.length).toBe(0);
    });
    it('applies all floors and definitions in one edit, exports native furniture, and undoes/redoes exact UIDs', async () => {
        const session = await service.inspect(), preview = await service.generate(session, session.preparation.analysis.rooms.map(room => room.id), 'apply');
        const count = await service.apply(preview), after = h.state.value.building!;
        expect(count).toBe(7); expect(h.state.value.past.length).toBe(1); expect(h.state.value.past[0].label).toBe('Auto furnish rooms');
        const furniture = after.floors.flatMap(floor => floor.objects.filter(o => o.type === 'furniture'));
        expect(new Set(furniture.map(o => o.uid)).size).toBe(count);
        expect(furniture.every(o => !!after.furniture[o.FurnitureTiles].entries.find(e => e.orient === o.orient))).toBeTrue();
        const reloaded = readBuildingFile(new DOMParser().parseFromString(new XMLSerializer().serializeToString(writeBuildingFile(after)), 'text/xml'));
        expect(reloaded.floors.map(floor => floor.objects.filter(o => o.type === 'furniture').length)).toEqual([2, 2, 3]);
        h.store.dispatch(new Undo()); expect(h.state.value.building).toBe(session.building); expect(h.state.value.building!.furniture.length).toBe(0);
        h.store.dispatch(new Redo()); expect(h.state.value.building).toBe(after);
        expect((await service.inspect()).preparation.analysis.rooms.every(room => !!furnishingRoomReason(preview.preparation, room))).toBeTrue();
    });
    it('rejects stale previews, even when a new document uses the same room geometry', async () => {
        const session = await service.inspect(), preview = await service.generate(session, [session.preparation.analysis.rooms[0].id], 'old');
        h.store.dispatch(new EditRooms({ x: 1, y: 1, width: 1, height: 1 }, 0, 0));
        await expectAsync(service.apply(preview)).toBeRejectedWithError(/building changed/);
        h.store.dispatch(new Undo());
        h.store.dispatch(new SetBuilding(session.building));
        await expectAsync(service.apply(preview)).toBeRejectedWithError(/building changed/);
        expect(h.state.value.past.length).toBe(0);
    });
    it('rechecks downloaded sprites and refuses to silently apply a different layout', async () => {
        const session = await service.inspect(), preview = await service.generate(session, [session.preparation.analysis.rooms[0].id], 'assets');
        available = false;
        await expectAsync(service.apply(preview)).toBeRejectedWithError(/Available tiles/);
        expect(h.state.value.building).toBe(session.building); expect(h.state.value.past.length).toBe(0);
    });
    it('requires acknowledgement for partial layouts and preserves valid placements', async () => {
        const tiny = furnishingBuilding([[1, 1], [1, 1]]);
        h.store.dispatch(new SetBuilding(tiny));
        const session = await service.inspect(), preview = await service.generate(session, [session.preparation.analysis.rooms[0].id], 'tiny');
        expect(preview.plans[0].status).toBe('partial');
        expect(preview.plans[0].placements.length).toBeGreaterThan(0);
        await expectAsync(service.apply(preview)).toBeRejectedWithError(/incomplete/);
        expect(h.state.value.past.length).toBe(0);
        expect(await service.apply(preview, true)).toBe(preview.plans[0].placements.length);
        expect(h.state.value.past.length).toBe(1);
    });
    it('never clears existing furniture, manual tiles or unsupported room types', async () => {
        const session = await service.inspect(), room = session.preparation.analysis.rooms[0];
        const withFurniture = { ...room, obstacles: [{ kind: 'furniture' as const, level: 0, blocksMovement: false, cells: [{ x: 1, y: 1 }] }] };
        expect(furnishingRoomReason(session.preparation, withFurniture)).toMatch(/already contains/);
        expect(furnishingRoomReason(session.preparation, { ...withFurniture, obstacles: [{ ...withFurniture.obstacles[0], kind: 'manual-tile' }] })).toMatch(/already contains/);
        expect(furnishingRoomReason(session.preparation, { ...room, suggestedType: 'hall' })).toMatch(/Only bedrooms/);
        session.preparation.analysis.rooms[0] = withFurniture;
        const original = h.state.value.building!;
        const object = { uid: 'existing', type: 'furniture', x: 2, y: 2, orient: 'W', FurnitureTiles: 999 };
        h.store.dispatch(new SetBuilding({ ...original, floors: original.floors.map((floor, index) => index ? floor : { ...floor, objects: [...floor.objects, object] }) }));
        const occupied = await service.inspect();
        await expectAsync(service.generate(occupied, [occupied.preparation.analysis.rooms[0].id], 'occupied')).toBeRejectedWithError(/already contains/);
        expect(h.state.value.building!.floors[0].objects.some(o => o.uid === 'existing')).toBeTrue();
    });
    it('cancels pending generation and apply without leaving edits or history', async () => {
        const session = await service.inspect(), id = session.preparation.analysis.rooms[0].id;
        const controller = new AbortController(); controller.abort();
        await expectAsync(service.generate(session, [id], 'cancel', controller.signal)).toBeRejectedWithError(/cancelled/);
        const preview = await service.generate(session, [id], 'cancel');
        const applying = new AbortController(), pending = service.apply(preview, false, applying.signal); applying.abort();
        await expectAsync(pending).toBeRejectedWithError(/cancelled/);
        expect(h.state.value.building).toBe(session.building); expect(h.state.value.past.length).toBe(0);
    });
    it('makes invalid batches and stale atomic commands complete no-ops', async () => {
        const session = await service.inspect(), definition = session.preparation.catalog.items[0].definition;
        const addition = { level: 0, object: { uid: 'new', type: 'furniture' as const, x: 2, y: 2, orient: 'W' }, definition };
        h.store.dispatch(new ApplyFurnishing(session.building, [addition, { ...addition, level: 999, object: { ...addition.object, uid: 'bad' } }]));
        expect(h.state.value.building).toBe(session.building); expect(h.state.value.past.length).toBe(0);
        h.store.dispatch(new ApplyFurnishing({ ...session.building }, [addition]));
        expect(h.state.value.building).toBe(session.building);
        h.store.dispatch(new ApplyFurnishing(session.building, [addition, addition]));
        expect(h.state.value.building).toBe(session.building);
    });
    it('defines recipes with only supported explicit goals', () => {
        expect(Object.keys(FURNISHING_RECIPES)).toEqual(['bedroom', 'bathroom', 'diningroom', 'kitchen', 'livingroom']);
    });

    for (const type of ['kitchen', 'livingroom']) for (const style of ['basic-residential', 'alternate-residential'] as const) {
        it(`plans a complete ${type} with the coordinated ${style} palette`, async () => {
            const building = furnishingBuilding(); building.rooms[0] = { ...building.rooms[0], Name: type, InternalName: type };
            h.store.dispatch(new SetBuilding(building));
            const session = await service.inspect(), room = session.preparation.analysis.rooms[0];
            expect(furnishingRoomReason(session.preparation, room)).toBeUndefined();
            const preview = await service.generate(session, [room.id], 'complex', undefined, style), plan = preview.plans[0];
            expect(plan.status).withContext(JSON.stringify(plan.unfilled)).toBe('complete');
            expect(plan.placements.length).toBe(type === 'kitchen' ? 5 : 4);
            for (const p of plan.placements) {
                const item = preview.preparation.catalog.items.find(item => item.id === p.catalogId)!;
                expect(item.style === style || item.compatibleStyles?.includes(style)).toBeTrue();
                expect(p.score.style).toBe(20);
            }
            const prefix: typeof plan.placements = [];
            for (const p of plan.placements) { expect(validateFurnishingPlacement(preview.preparation, room.id, p, prefix, { maxCoverage: .55 }).valid).toBeTrue(); prefix.push(p); }
            if (type === 'kitchen') {
                const sink = plan.placements.find(p => p.requestId === 'sink')!, counter = plan.placements.find(p => p.requestId === 'counter')!;
                expect(sink.orient).toBe(counter.orient); expect(Math.abs(sink.x - counter.x) + Math.abs(sink.y - counter.y)).toBe(1);
            }
            expect(await service.apply(preview)).toBe(plan.placements.length);
            h.store.dispatch(new Undo()); expect(h.state.value.building).toBe(session.building);
        });
    }
    for (const shape of ['L', 'C', 'courtyard', 'neck']) for (const type of ['kitchen', 'livingroom']) {
        it(`keeps ${type} furniture and access inside a ${shape}-shaped room and preserves circulation`, async () => {
            const grid = Array.from({ length: 9 }, (_, y) => Array.from({ length: 9 }, (_, x) =>
                shape === 'L' ? (x < 4 || y < 4 ? 1 : 0) : shape === 'C' ? (x < 3 || y < 3 || y >= 6 ? 1 : 0)
                : shape === 'courtyard' ? (x >= 3 && x <= 5 && y >= 3 && y <= 5 ? 0 : 1)
                : (x < 3 || x >= 6 || y === 4 ? 1 : 0)));
            const building = furnishingBuilding(grid); building.rooms[0] = { ...building.rooms[0], Name: type, InternalName: type };
            h.store.dispatch(new SetBuilding(building)); const session = await service.inspect(), room = session.preparation.analysis.rooms[0];
            expect(session.preparation.analysis.rooms.length).toBe(1);
            const preview = await service.generate(session, [room.id], `shape-${shape}`, undefined, 'alternate-residential'), plan = preview.plans[0];
            expect(plan.requiredSatisfied).withContext(JSON.stringify(plan.unfilled)).toBeTrue();
            const prefix: typeof plan.placements = [];
            for (const p of plan.placements) {
                expect([...p.footprint, ...p.accessCells].every(cell => grid[cell.y]?.[cell.x] === 1)).toBeTrue();
                expect(validateFurnishingPlacement(preview.preparation, room.id, p, prefix, { maxCoverage: .55 }).valid).toBeTrue(); prefix.push(p);
                if (shape === 'neck') expect(p.blockedCells.some(cell => cell.y === 4 && cell.x >= 3 && cell.x <= 5)).toBeFalse();
            }
            expect(h.state.value.past.length).toBe(0);
        });
    }
    it('keeps a selected style across rooms, regeneration, asset rechecks and one-step Apply/Undo', async () => {
        const building = furnishingBuilding(), base = building.rooms[0];
        building.rooms = ['bedroom', 'diningroom', 'kitchen', 'livingroom'].map(name => ({ ...base, Name: name, InternalName: name }));
        building.floors = building.rooms.map((_, level) => ({ rooms: writeIndexGrid(Array.from({ length: 6 }, () => Array(6).fill(level + 1))),
            objects: [{ uid: `styled-entry-${level}`, type: 'door', x: 0, y: 0, dir: 'N', Tile: 0 }] }));
        h.store.dispatch(new SetBuilding(building));
        const session = await service.inspect(), ids = session.preparation.analysis.rooms.map(room => room.id);
        const preview = await service.generate(session, ids, 'coordinated', undefined, 'alternate-residential');
        expect((await service.generate(session, [...ids].reverse(), 'coordinated', undefined, 'alternate-residential')).plans).toEqual(preview.plans);
        expect((await service.generate(session, ids, 'coordinated:1', undefined, 'alternate-residential')).style).toBe('alternate-residential');
        expect(preview.plans.every(plan => plan.requiredSatisfied)).toBeTrue();
        await service.apply(preview, true); expect(h.state.value.past.length).toBe(1);
        const after = h.state.value.building!;
        h.store.dispatch(new Undo()); expect(h.state.value.building).toBe(session.building);
        h.store.dispatch(new Redo()); expect(h.state.value.building).toBe(after);
    });
    it('reports missing style-specific furniture instead of silently replacing it with another set', async () => {
        const building = furnishingBuilding(); building.rooms[0] = { ...building.rooms[0], Name: 'kitchen', InternalName: 'kitchen' };
        h.store.dispatch(new SetBuilding(building));
        const filtered = new AutoFurnishingAnalysisService({ get: () => of(source) } as any,
            { getTile: async (name: string) => name.startsWith('fixtures_counters_01_01') || name === 'fixtures_counters_01_009.png' ? null : {} } as any);
        const styled = new AutoFurnishingService(filtered, h.store as any), session = await styled.inspect();
        const preview = await styled.generate(session, [session.preparation.analysis.rooms[0].id], 'missing-set', undefined, 'alternate-residential');
        expect(preview.plans[0].status).toBe('partial');
        expect(preview.plans[0].unfilled.some(goal => goal.requestId === 'counter')).toBeTrue();
        expect(preview.plans[0].placements.some(p => p.catalogId === 'basic.counter')).toBeFalse();
        await expectAsync(styled.apply(preview)).toBeRejectedWithError(/incomplete/);
        await expectAsync(styled.generate(session, preview.roomIds, 'invalid', undefined, 'unknown' as any)).toBeRejectedWithError(/supported furnishing style/);
    });
});
