import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as Actions from './app.actions';
import { Building } from './models/app.models';

export interface State
{
    building: Building | undefined;
    currentTool: string;
    redraw: boolean;
}

export const initialState: State = {
    building: undefined,
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

      //Building
      case Actions.ActionTypes.SetBuilding: {
        return {
          ...state,
          building: action.building
        }
      }
      case Actions.ActionTypes.AddObject: {
        if (!state.building) {
          return state;
        }
        const updatedBuilding: Building = {
          ...state.building,
          floors: state.building.floors.map((floor, index) => {
            if (index === action.level) {
              return {
                ...floor,
                objects: [...floor.objects, action.obj]
              };
            }
            return floor;
          })
        };
      
        return {
          ...state,
          building: updatedBuilding
        };
      }
      

      default: {
        return state;
      }
    }
  }

export const getRootState = createFeatureSelector<State>('root');
export const getBuilding = createSelector(getRootState, (state: State) => state.building);
export const getCurrentTool = createSelector(getRootState, (state: State) => state.currentTool);
export const getRedrawSchedule = createSelector(getRootState, (state: State) => state.redraw);