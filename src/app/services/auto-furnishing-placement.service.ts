import { Injectable } from '@angular/core';
import { Building } from '../models/app.models';
import { FurnishingEngineOptions, FurnishingPlacementRequest, FurnishingPreparation, FurnishingRoomPlan } from '../models/auto-furnishing.models';
import { planFurnishingRoom } from '../utils/furnishing-placement';
import { AutoFurnishingAnalysisService } from './auto-furnishing-analysis.service';

/** Low-level read-only orchestration for explicit engine requests. */
@Injectable({ providedIn: 'root' })
export class AutoFurnishingPlacementService {
    constructor(private analysis: AutoFurnishingAnalysisService) { }
    async plan(building: Building, rooms: { roomId: string; requests: FurnishingPlacementRequest[]; options?: FurnishingEngineOptions }[],
        options: FurnishingEngineOptions = {}): Promise<{ preparation: FurnishingPreparation; plans: FurnishingRoomPlan[] }> {
        if (new Set(rooms.map(room => room.roomId)).size !== rooms.length) throw new Error('Each room may be planned once per operation.');
        const preparation = await this.analysis.prepare(building);
        const plans = [...rooms].sort((a, b) => a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0)
            .map(room => planFurnishingRoom(preparation, room.roomId, room.requests, { ...options, ...room.options }));
        return { preparation, plans };
    }
}
