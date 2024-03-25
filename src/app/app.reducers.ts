import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as Actions from './app.actions';
import { Building } from './models/app.models';

export interface State
{
    building: Building | undefined;
    currentTool: string;
    redraw: boolean;
    loading: boolean;
    tileCount: number;
}

export const initialState: State = {
    building: undefined,
    currentTool: 'tool-draw-room',
    redraw: false,
    loading: false,
    tileCount: 0
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
      case Actions.ActionTypes.SetTileCount: {
        return {
          ...state,
          tileCount: state.tileCount + action.tileCount
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
      case Actions.ActionTypes.RemoveObject: {
        if (!state.building) {
          return state;
        }
      
       

        const updatedBuilding: Building = {
          ...state.building,
          floors: state.building.floors.map((floor, index) => {
            if (index === action.level) {
              return {
                ...floor,
                objects: floor.objects.filter(object => {
                  return object.x !== action.obj.x || object.y !== action.obj.y || object.type !== action.obj.type || object.orient !== action.obj.orient;
                })
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
export const getTileCount = createSelector(getRootState, (state: State) => state.tileCount);