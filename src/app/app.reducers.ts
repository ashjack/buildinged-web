import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as Actions from './app.actions';
import { Building } from './models/app.models';
import { VisualFurniture } from './models/furniture-window.models';

import { editRooms, editTiles } from './utils/document-edits';
import { registerFurniture } from './utils/furniture-definition';
import { paintTileCells, transformSelection } from './utils/selection-edits';
import { editFloor } from './utils/floor-edits';

export interface State
{
    building: Building | undefined;
    documentId: number;
    past: EditCommand[];
    future: EditCommand[];
    historyFloor: number | undefined;
    currentTool: string;
    selectedfurniture: VisualFurniture | undefined;
    selectedFurnitureOrient: string;
    redraw: boolean;
    loading: boolean;
    tileCount: number;
    popups: string[];
}

export const initialState: State = {
    building: undefined,
    documentId: 0,
    past: [],
    future: [],
    historyFloor: undefined,
    selectedfurniture: undefined,
    selectedFurnitureOrient: 'W',
    currentTool: 'tool-draw-room',
    redraw: false,
    loading: false,
    tileCount: 0,
    popups: []
}

export interface EditCommand {
    label: string;
    before: Building;
    after: Building;
    level: number;
    afterLevel?: number;
}

export const HISTORY_LIMIT = 100;

function commandLabel(action: Actions.ActionsUnion): string {
    switch (action.type) {
      case Actions.ActionTypes.EditFloor: return ({ add: 'Add floor', duplicate: 'Duplicate floor', remove: 'Remove floor', up: 'Raise floor', down: 'Lower floor' })[action.operation];
      case Actions.ActionTypes.EditRooms: return action.room === 0 ? 'Erase rooms' : 'Draw rooms';
      case Actions.ActionTypes.RemoveRoom: return 'Erase rooms';
      case Actions.ActionTypes.AddRoom: return action.room === 0 ? 'Erase rooms' : 'Draw rooms';
      case Actions.ActionTypes.EditTiles: return action.tile === null ? 'Erase tiles' : 'Place tiles';
      case Actions.ActionTypes.PaintTileCells: return action.cells.every(cell => cell.tile === null) ? 'Erase tiles' : 'Paint tiles';
      case Actions.ActionTypes.TransformSelection: return `${action.edit.erase ? 'Delete' : 'Move'} ${action.edit.mode}`;
      case Actions.ActionTypes.RemoveTile: return 'Erase tiles';
      case Actions.ActionTypes.AddTile: return 'Place tile';
      case Actions.ActionTypes.AddObject: return `Place ${action.obj.type}`;
      case Actions.ActionTypes.RemoveObject: return 'Delete object';
      case Actions.ActionTypes.RemoveObjects: return 'Erase objects';
      default: return 'Edit object';
    }
}

/** Existing actions are edit commands; snapshots share their unchanged immutable data. */
export function reducer(state = initialState, action: Actions.ActionsUnion): State {
    if (action.type === Actions.ActionTypes.Undo || action.type === Actions.ActionTypes.Redo) {
        const undo = action.type === Actions.ActionTypes.Undo;
        const list = undo ? state.past : state.future;
        const command = list[list.length - 1];
        if (!command) return state;
        return {
            ...state, building: undo ? command.before : command.after, historyFloor: undo ? command.level : command.afterLevel ?? command.level,
            past: undo ? state.past.slice(0, -1) : [...state.past, command],
            future: undo ? [...state.future, command] : state.future.slice(0, -1),
        };
    }
    const next = reduceState(state, action);
    if (action.type === Actions.ActionTypes.SetBuilding) return { ...next, past: [], future: [], historyFloor: undefined };
    if (!state.building || next.building === state.building) return next;
    const level = 'level' in action ? action.level : state.building.floors.findIndex((floor, index) => floor !== next.building!.floors[index]);
    const floorEdit = action.type === Actions.ActionTypes.EditFloor;
    const command = { label: commandLabel(action), before: state.building, after: next.building!, level: Math.max(0, level),
        ...(floorEdit ? { afterLevel: next.historyFloor } : {}) };
    return { ...next, past: [...state.past, command].slice(-HISTORY_LIMIT), future: [], historyFloor: floorEdit ? next.historyFloor : undefined };
}

function reduceState(state: State, action: Actions.ActionsUnion): State {
    switch (action.type) {
      case Actions.ActionTypes.SetCurrentTool: {
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
      case Actions.ActionTypes.SetSelectedFurniture: {
        return {
          ...state,
          selectedfurniture: action.furniture,
          selectedFurnitureOrient: action.orient,
        };
      }

      //Popup
      case Actions.ActionTypes.TogglePopup: {
        const { popupName, open } = action;
        const existingIndex = state.popups.findIndex(popup => popup === popupName);
      
        if (open) {
          if (existingIndex === -1) {
            return {
              ...state,
              popups: [...state.popups,  popupName]
            };
          }
        } else {
          if (existingIndex !== -1) {
            const updatedPopups = [...state.popups];
            updatedPopups.splice(existingIndex, 1);
            return {
              ...state,
              popups: updatedPopups
            };
          }
        }
        return state;
      }

      //Building
      case Actions.ActionTypes.EditFloor: {
        if (!state.building) return state;
        const result = editFloor(state.building, action);
        return result ? { ...state, building: result.building, historyFloor: result.level } : state;
      }
      case Actions.ActionTypes.PaintTileCells:
      case Actions.ActionTypes.TransformSelection: {
        if (!state.building) return state;
        const building = action.type === Actions.ActionTypes.PaintTileCells
            ? paintTileCells(state.building, action.level, action.layer, action.cells)
            : transformSelection(state.building, action.edit);
        return building === state.building ? state : { ...state, building };
      }
      case Actions.ActionTypes.SetBuilding: {
        return {
          ...state,
          building: action.building,
          documentId: state.documentId + 1,
        }
      }
      case Actions.ActionTypes.AddRoom:
      case Actions.ActionTypes.RemoveRoom:
      case Actions.ActionTypes.EditRooms: {
        if (!state.building) return state;
        const area = action.type === Actions.ActionTypes.EditRooms ? action.area : { x: action.x, y: action.y, width: 1, height: 1 };
        const room = action.type === Actions.ActionTypes.RemoveRoom ? 0 : action.room;
        const building = editRooms(state.building, action.level, area, room);
        return building === state.building ? state : { ...state, building };
      }
      case Actions.ActionTypes.AddTile:
      case Actions.ActionTypes.RemoveTile:
      case Actions.ActionTypes.EditTiles: {
        if (!state.building) return state;
        const area = action.type === Actions.ActionTypes.EditTiles ? action.area : { x: action.x, y: action.y, width: 1, height: 1 };
        const tile = action.type === Actions.ActionTypes.RemoveTile ? null : action.type === Actions.ActionTypes.EditTiles ? action.tile : action.url;
        const building = editTiles(state.building, action.level, area, action.layer, tile);
        return building === state.building ? state : { ...state, building };
      }

      case Actions.ActionTypes.AddObject: {
        const building = state.building;
        if (!building || !building.floors[action.level] || building.floors.some(floor => floor.objects.some(object => object.uid === action.obj.uid))) return state;
        const registered = action.obj.type === 'furniture' && action.furnitureDefinition
          ? registerFurniture(building.furniture, action.furnitureDefinition) : undefined;
        const object = registered ? { ...action.obj, FurnitureTiles: registered.index } : action.obj;
        return {
          ...state,
          building: {
            ...building,
            furniture: registered?.furniture || building.furniture,
            floors: building.floors.map((floor, index) => index === action.level
              ? { ...floor, objects: [...floor.objects, object] } : floor),
          },
        };
      }
      case Actions.ActionTypes.UpdateObject:
      case Actions.ActionTypes.RemoveObject: {
        const building = state.building;
        if (!building || !action.uid) return state;
        const level = building.floors.findIndex(floor => floor.objects.some(object => object.uid === action.uid));
        if (level < 0) return state;
        const floor = building.floors[level];
        let objects: typeof floor.objects;
        if (action.type === Actions.ActionTypes.RemoveObject) {
          objects = floor.objects.filter(object => object.uid !== action.uid);
        } else {
          const { uid: ignored, ...changes } = action.changes;
          const original = floor.objects.find(object => object.uid === action.uid)!;
          if (!Object.entries(changes).some(([key, value]) => original[key] !== value)) return state;
          objects = floor.objects.map(object => object.uid === action.uid ? { ...object, ...changes } : object);
        }
        return { ...state, building: { ...building, floors: building.floors.map((value, index) => index === level ? { ...floor, objects } : value) } };
      }

      case Actions.ActionTypes.RemoveObjects: {
        const building = state.building;
        if (!building) return state;
        const uids = new Set(action.uids);
        const floors = building.floors.map(floor => {
            const objects = floor.objects.filter(object => !uids.has(object.uid));
            return objects.length === floor.objects.length ? floor : { ...floor, objects };
        });
        return floors.every((floor, index) => floor === building.floors[index]) ? state : { ...state, building: { ...building, floors } };
      }

      default: {
        return state;
      }
    }
  }

export const getRootState = createFeatureSelector<State>('root');
export const getBuilding = createSelector(getRootState, (state: State) => state.building);
export const getDocumentId = createSelector(getRootState, (state: State) => state.documentId);
export const getHistoryFloor = createSelector(getRootState, state => state.historyFloor);
export const getDocumentProjection = createSelector(getBuilding, getDocumentId, getHistoryFloor, (building, documentId, historyFloor) => ({ building, documentId, historyFloor }));
export const getUndoLabel = createSelector(getRootState, state => state.past[state.past.length - 1]?.label);
export const getRedoLabel = createSelector(getRootState, state => state.future[state.future.length - 1]?.label);
export const getSelectedFurniture = createSelector(getRootState, (state: State) => state.selectedfurniture);
export const getSelectedFurnitureOrient = createSelector(getRootState, (state: State) => state.selectedFurnitureOrient);
export const getCurrentTool = createSelector(getRootState, (state: State) => state.currentTool);
export const getRedrawSchedule = createSelector(getRootState, (state: State) => state.redraw);
export const getTileCount = createSelector(getRootState, (state: State) => state.tileCount);
export const getPopups = createSelector(getRootState, (state: State) => state.popups);

export const isPopupOpen = (name: string) => createSelector(getPopups, (popups) => {
  return popups.some(popup => popup === name);
});
