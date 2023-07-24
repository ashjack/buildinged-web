import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as Actions from './app.actions';

export interface State
{
    currentTool: string;

}

export const initialState: State = {
    currentTool: 'tool-draw-room'
}

export function reducer(state = initialState, action: Actions.ActionsUnion): State {
    console.log(`reducer: ${action.type}`);
    switch (action.type) {
      case Actions.ActionTypes.SetCurrentTool: {
        console.log(state);
        return {
          ...state,
            currentTool: action.tool
        };
      }

      default: {
        return state;
      }
    }
  }

export const getRootState = createFeatureSelector<State>('root');
export const getCurrentTool = createSelector(getRootState, (state: State) => state.currentTool);