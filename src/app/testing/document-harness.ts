import { BehaviorSubject, distinctUntilChanged, map, of, Subject, Subscription } from 'rxjs';
import { ActionsUnion, SetBuilding } from '../app.actions';
import { RootEffects } from '../app.effects';
import { initialState, reducer, State } from '../app.reducers';
import { Building } from '../models/app.models';
import { BuildingService } from '../services/building.service';
import { GridService } from '../services/grid.service';
import { RoomService } from '../services/room.service';

/** Runs the real reducers, document effects and renderer without canvas or tile downloads. */
export function documentHarness(initial?: Building, template = '') {
    const state = new BehaviorSubject<State>(initialState);
    const actions = new Subject<ActionsUnion>();
    const dispatched: ActionsUnion[] = [];
    const store = {
        select: (selector: (state: { root: State }) => any) => state.pipe(map(value => selector({ root: value })), distinctUntilChanged()),
        dispatch: (action: ActionsUnion) => {
            dispatched.push(action);
            state.next(reducer(state.value, action));
            actions.next(action);
        },
    };
    const grid = new GridService(null!, null!);
    spyOn(grid, 'getIndividualTile').and.callFake(name => name);
    const rooms = new RoomService(grid, store as any);
    const buildings = new BuildingService(null!, null!, grid, rooms, store as any, { get: () => of(template) } as any);
    const effects = new RootEffects(store as any, buildings);
    const subscriptions = new Subscription();
    subscriptions.add(effects.renderDocument$.subscribe(action => store.dispatch(action)));
    if (initial) store.dispatch(new SetBuilding(initial));
    return { state, actions, dispatched, store, grid, rooms, buildings, effects,
        destroy: () => { subscriptions.unsubscribe(); state.complete(); actions.complete(); } };
}
