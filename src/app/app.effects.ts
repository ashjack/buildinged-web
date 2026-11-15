import { Injectable, Optional } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest, debounceTime, defer, EMPTY, filter, map, pairwise, startWith, tap } from 'rxjs';
import { ScheduleRedraw, SyncBuildingMaterials } from './app.actions';
import * as fromRoot from './app.reducers';
import { Building } from './models/app.models';
import { BuildingService } from './services/building.service';
import { BuildingTilesLibraryService } from './services/building-tiles-library.service';
import { overrideBuildingMaterials } from './utils/material-catalog';

@Injectable()
export class RootEffects {

    constructor(private store: Store<fromRoot.State>, private buildings: BuildingService,
        @Optional() private materials: BuildingTilesLibraryService | null = null) { }

    syncBuildingMaterials$ = createEffect(() => this.materials ? combineLatest([
        this.store.select(fromRoot.getBuilding).pipe(tap(building => {
            if (building) void this.materials!.load().catch(() => undefined);
        })),
        this.materials.entries$,
    ]).pipe(
        filter(([building]) => !!building),
        map(([building, catalog]) => ({ before: building!, after: overrideBuildingMaterials(building!, catalog) })),
        filter(({ before, after }) => before !== after),
        map(({ before, after }) => new SyncBuildingMaterials(before, after)),
    ) : defer(() => EMPTY));

    renderDocument$ = createEffect(() => this.store.select(fromRoot.getDocumentProjection).pipe(
        startWith({ building: undefined, documentId: -1, historyFloor: undefined }),
        pairwise(),
        filter(([, current]) => !!current.building),
        map(([previous, current]) => {
            this.buildings.renderBuilding(current.building!, previous.documentId !== current.documentId, current.historyFloor);
            return new ScheduleRedraw(true);
        }),
    ));

    cacheDocument$ = createEffect(() => this.store.select(fromRoot.getBuilding).pipe(
        filter((building): building is Building => !!building),
        map(building => ({ building, target: this.buildings.cacheTarget })),
        debounceTime(200),
        tap(({ building, target }) => this.buildings.cacheBuilding(building, target)),
    ), { dispatch: false });
}
