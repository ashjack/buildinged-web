import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom, take } from 'rxjs';
import { ApplyFurnishing } from '../app.actions';
import * as fromRoot from '../app.reducers';
import { Building } from '../models/app.models';
import { FurnishingPreparation, FurnishingRoomPlan } from '../models/auto-furnishing.models';
import { furnishingRecipeRequests, furnishingRoomReason, FurnishingStyle, FURNISHING_STYLES } from '../utils/furnishing-recipes';
import { planFurnishingRoom } from '../utils/furnishing-placement';
import { GUID } from '../utils/guid';
import { AutoFurnishingAnalysisService } from './auto-furnishing-analysis.service';

export interface FurnishingSession { building: Building; documentId: number; preparation: FurnishingPreparation; }
export interface FurnishingPreview extends FurnishingSession { roomIds: string[]; seed: string; style: FurnishingStyle; plans: FurnishingRoomPlan[]; }
const signature = (plans: FurnishingRoomPlan[]) => JSON.stringify(plans.map(plan => [plan.roomId, plan.status,
    plan.placements.map(p => [p.requestId, p.catalogId, p.orient, p.x, p.y]), plan.unfilled]));

@Injectable({ providedIn: 'root' })
export class AutoFurnishingService {
    constructor(private analysis: AutoFurnishingAnalysisService, private store: Store<fromRoot.State>) { }
    private current() { return firstValueFrom(this.store.select(fromRoot.getDocumentProjection).pipe(take(1))); }
    private async assertCurrent(session: FurnishingSession): Promise<void> {
        const current = await this.current();
        if (current.building !== session.building || current.documentId !== session.documentId)
            throw new Error('The building changed. Refresh the room list and generate a new preview.');
    }
    async inspect(): Promise<FurnishingSession> {
        const current = await this.current();
        if (!current.building) throw new Error('Open a building first.');
        const session = { building: current.building, documentId: current.documentId, preparation: await this.analysis.prepare(current.building) };
        await this.assertCurrent(session); return session;
    }
    async generate(session: FurnishingSession, roomIds: string[], seed: string, signal?: AbortSignal,
        style: FurnishingStyle = 'basic-residential'): Promise<FurnishingPreview> {
        const checkCancelled = () => { if (signal?.aborted) throw new Error('Furnishing cancelled.'); };
        checkCancelled();
        if (!FURNISHING_STYLES.some(choice => choice.id === style)) throw new Error('Choose a supported furnishing style.');
        await this.assertCurrent(session);
        if (!roomIds.length || new Set(roomIds).size !== roomIds.length) throw new Error('Select one or more distinct empty rooms.');
        const preparation = await this.analysis.prepare(session.building), plans: FurnishingRoomPlan[] = [];
        for (const roomId of [...roomIds].sort()) {
            const room = preparation.analysis.rooms.find(room => room.id === roomId);
            if (!room) throw new Error('A selected room no longer exists. Refresh the room list.');
            const reason = furnishingRoomReason(preparation, room);
            if (reason) throw new Error(`${room.name}: ${reason}`);
            // Yield between rooms so the busy state can paint; search itself uses deterministic work limits.
            await new Promise(resolve => setTimeout(resolve, 0));
            checkCancelled();
            await this.assertCurrent(session);
            const complex = ['kitchen', 'livingroom'].includes(room.suggestedType) || room.cells.length !== room.bounds.width * room.bounds.height;
            plans.push(planFurnishingRoom(preparation, roomId, furnishingRecipeRequests(room.suggestedType, style, room),
                { seed, style, maxCoverage: 0.55, ...(complex ? { spatialDiversity: true, beamWidth: 16,
                    branchesPerState: 12, maxCandidateChecks: 24000, maxSearchChecks: 32000 } : {}) }));
        }
        await this.assertCurrent(session);
        checkCancelled();
        return { ...session, preparation, seed, style, roomIds: [...roomIds].sort(), plans };
    }
    async apply(preview: FurnishingPreview, allowPartial = false, signal?: AbortSignal): Promise<number> {
        // Re-run the same recipes against fresh asset availability. Apply exactly what was previewed.
        const fresh = await this.generate(preview, preview.roomIds, preview.seed, signal, preview.style);
        if (signature(fresh.plans) !== signature(preview.plans)) throw new Error('Available tiles or the proposed layout changed. Regenerate the preview before applying.');
        if (!allowPartial && fresh.plans.some(plan => plan.status !== 'complete')) throw new Error('Review and allow incomplete rooms before applying this partial result.');
        const additions = fresh.plans.flatMap(plan => plan.placements.map(placement => ({
            level: placement.level,
            object: { uid: GUID.generateGUID(), type: 'furniture' as const, x: placement.x, y: placement.y, orient: placement.orient },
            definition: fresh.preparation.catalog.items.find(item => item.id === placement.catalogId)!.definition
        })));
        if (!additions.length) throw new Error('There are no furniture placements to apply.');
        await this.assertCurrent(preview);
        if (signal?.aborted) throw new Error('Furnishing cancelled.');
        this.store.dispatch(new ApplyFurnishing(preview.building, additions));
        if ((await this.current()).building === preview.building) throw new Error('The building changed before this edit could be applied. Generate a new preview.');
        return additions.length;
    }
}
