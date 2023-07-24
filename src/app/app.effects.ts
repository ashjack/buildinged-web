import { Injectable } from "@angular/core";
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { State } from "./app.reducers";
import { Store } from "@ngrx/store";
import { ActionTypes, SetCurrentTool } from "./app.actions";
import { map, tap } from "rxjs";

@Injectable()
export class RootEffects {

    constructor(
        private actions$: Actions,
        private store: Store<State>
    ) { }

    /*setTool$ = createEffect(() => this.actions$.pipe(
        ofType<SetCurrentTool>(ActionTypes.SetCurrentTool),
        map(action => {

        }*/

}