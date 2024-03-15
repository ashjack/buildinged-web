import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as Actions from './app.actions';

export interface State
{
    currentTool: string;
    redraw: boolean;
}

export const initialState: State = {
    currentTool: 'tool-draw-room',
    redraw: false
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
      case Actions.ActionTypes.ScheduleRedraw: {
        return {
          ...state,
          redraw: action.schedule
        }
      }

      default: {
        return state;
      }
    }
  }

export const getRootState = createFeatureSelector<State>('root');
export const getCurrentTool = createSelector(getRootState, (state: State) => state.currentTool);
export const getRedrawSchedule = createSelector(getRootState, (state: State) => state.redraw);