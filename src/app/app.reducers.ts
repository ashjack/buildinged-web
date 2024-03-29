import { createFeatureSelector, createSelector } from '@ngrx/store';
import * as Actions from './app.actions';
import { Building, FurnitureTileEntry, SvgTile } from './models/app.models';
import { VisualFurniture } from './models/furniture-window.models';

export interface State
{
    building: Building | undefined;
    currentTool: string;
    selectedfurniture: VisualFurniture | undefined;
    redraw: boolean;
    loading: boolean;
    tileCount: number;
    popups: string[];
}

export const initialState: State = {
    building: undefined,
    selectedfurniture: undefined,
    currentTool: 'tool-draw-room',
    redraw: false,
    loading: false,
    tileCount: 0,
    popups: []
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
      case Actions.ActionTypes.SetSelectedFurniture: {

        if (!state.building) {
          return {
            ...state,
            selectedfurniture: action.furniture
          };
        }

        let furn = [...state.building.furniture]

        // furn.push({
        //   entries: action.furniture.tiles
        // })

        const updatedBuilding: Building = {
          ...state.building,
          furniture: furn
        }

        return {
          ...state,
          selectedfurniture: action.furniture,
          building: updatedBuilding
        }
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
      case Actions.ActionTypes.SetBuilding: {
        return {
          ...state,
          building: action.building
        }
      }
      case Actions.ActionTypes.AddRoom: {
        if (!state.building) {
          return state;
        }

        const updatedBuilding: Building = {
          ...state.building,
          floors: state.building.floors.map((floor, index) => {
            if (index === action.level) {
              const updatedRooms = floor.rooms.split('\n').map((col, colIndex) => {
                return col.split(',').map((row, rowIndex) => {
                  if (colIndex === action.y + 1 && rowIndex === action.x) {
                    console.log('Found match at ', colIndex, rowIndex)
                    return action.room;
                  }
                  return row;
                }).join(',');
              }).join('\n');
              return {
                ...floor,
                rooms: updatedRooms
              };
            }
            return floor;
          })
        }

        return {
          ...state,
          building: updatedBuilding
        };
      }

      case Actions.ActionTypes.AddTile: {
        if (!state.building) {
          return state;
        }

        //Get/Create user_tile listing
        let userTileIndex = state.building.user_tiles.findIndex(x => x.tile == action.url.replace(".png", ""))
        let updatedUserTiles = state.building.user_tiles;
        console.log(userTileIndex)
        if(userTileIndex == -1)
        {
          updatedUserTiles = [...state.building.user_tiles, { tile: action.url.replace(".png", "") }];
          userTileIndex = updatedUserTiles.length;
        }
        else
        {
          userTileIndex++;
        }

        const updatedBuilding: Building = {
          ...state.building,
          user_tiles: updatedUserTiles,
          floors: state.building.floors.map((floor, index) => {
            if (index === action.level) {
              // Found existing layer to modify
              const existingLayerIndex = floor.tileLayers?.findIndex(layer => layer.layer === action.layer) ?? -1;
              if (existingLayerIndex !== -1) {
                const updatedTileLayers = [...floor.tileLayers!];
                const layer = updatedTileLayers[existingLayerIndex];
        
                const tilesArray = layer.tiles.split('\n').map(row => row.split(','));
        
                tilesArray[action.y][action.x] = userTileIndex.toString();
        
                const updatedTiles = tilesArray.map(row => row.join(',')).join('\n');
        
                updatedTileLayers[existingLayerIndex] = {
                  ...layer,
                  tiles: updatedTiles
                };
        
                return {
                  ...floor,
                  tileLayers: updatedTileLayers
                };
              } else {
                // Create new layer
                const newLayer = {
                  layer: action.layer,
                  tiles: createEmptyMatrix(state.building!.width + 1, state.building!.height + 1, action.x, action.y, userTileIndex)
                };
                const updatedTileLayers = floor.tileLayers ? [...floor.tileLayers, newLayer] : [newLayer];
              
                return {
                  ...floor,
                  tileLayers: updatedTileLayers
                };
              }
              
              function createEmptyMatrix(width: number, height: number, posX: number, posY: number, tileIndex: number) {
                const matrix = [];
                for (let y = 0; y < height; y++) {
                  const row = [];
                  for (let x = 0; x < width; x++) {
                    if (x === posX && y === posY) {
                      row.push(tileIndex.toString());
                    } else {
                      row.push('0');
                    }
                  }
                  matrix.push(row.join(','));
                }
                return '\n' + matrix.join(',\n') + '\n';
              }
              
              
            }
            return floor;
          })
        };
        
        return {
          ...state,
          building: updatedBuilding
        };
      }        

      case Actions.ActionTypes.AddObject: {
        if (!state.building) {
          return state;
        }

        if(action.obj.type == 'furniture')
        {
          const furnitureObj = {
            type: 'furniture',
            FurnitureTiles: 0,
            orient: action.obj.orient,
            x: action.obj.x,
            y: action.obj.y,
          }

          // let foundMatchingFurniture = false;
          // state.building.furniture.forEach((furniture, fIndex) => {
          //   if(!foundMatchingFurniture){
          //     furniture.entries.forEach((entry, eIndex) => {
          //       if(!foundMatchingFurniture) {
          //         const allTilesMatch = action.obj.FurnitureTiles.every((tileToMatch: any) => {
          //           return entry.tiles.some((tile) => {
          //             return tile.name === tileToMatch.name && tile.x === tileToMatch.x && tile.y === tileToMatch.y;
          //           });
          //         });
                  

          //         if (allTilesMatch) {
          //           foundMatchingFurniture = true;
          //           furnitureObj.FurnitureTiles = fIndex;
          //         }
          //       }
          //     });
          //   }
          // });

          let furn = state.building.furniture;

          //if (!foundMatchingFurniture) //Add tiles to furniture
          //{
            furn = [...state.building.furniture]

            const entries: FurnitureTileEntry[] = [];
            action.obj.FurnitureTiles.forEach((tile: SvgTile) => {
              console.log(tile)
            })

            // furn.push({
            //   entries: 
            // })
          //}

          const updatedBuilding: Building = {
            ...state.building,
            furniture: furn,
            floors: state.building.floors.map((floor, index) => {
              if (index === action.level) {
                return {
                  ...floor,
                  objects: [...floor.objects, furnitureObj]
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
export const getSelectedFurniture = createSelector(getRootState, (state: State) => state.selectedfurniture);
export const getCurrentTool = createSelector(getRootState, (state: State) => state.currentTool);
export const getRedrawSchedule = createSelector(getRootState, (state: State) => state.redraw);
export const getTileCount = createSelector(getRootState, (state: State) => state.tileCount);
export const getPopups = createSelector(getRootState, (state: State) => state.popups);

export const isPopupOpen = (name: string) => createSelector(getPopups, (popups) => {
  return popups.some(popup => popup === name);
});
