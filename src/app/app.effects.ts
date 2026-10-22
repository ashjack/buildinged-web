import { Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { debounceTime, filter, map, pairwise, startWith, tap } from 'rxjs';
import { ScheduleRedraw } from './app.actions';
import * as fromRoot from './app.reducers';
import { Building } from './models/app.models';
import { BuildingService } from './services/building.service';

@Injectable()
export class RootEffects {

    constructor(private store: Store<fromRoot.State>, private buildings: BuildingService) { }

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
        debounceTime(200),
        tap(building => this.buildings.cacheBuilding(building)),
    ), { dispatch: false });
}
