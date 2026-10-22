import { Action } from "@ngrx/store";
import { Building, Furniture, Room, TileArea } from "./models/app.models";
import { RoomDefinitionDraft } from './utils/room-definitions';
import { cloneRoomEntry } from './utils/room-tile-entries';
import { GUID } from './utils/guid';
import { VisualFurniture } from "./models/furniture-window.models";
import { SelectionEdit, TileCellEdit } from './utils/selection-edits';

export enum ActionTypes {
    SetBuilding = '[Building] Set Building',
    AddObject = '[Building] Add Object',
    UpdateObject = '[Building] Update Object',
    RemoveObject = '[Building] Remove Object',
    RemoveObjects = '[Building] Remove Objects',
    Undo = '[Building] Undo',
    Redo = '[Building] Redo',
    AddRoom = '[Building] Add Room',
    RemoveRoom = '[Building] Remove Room',
    AddTile = '[Building] Add Tile',
    RemoveTile = '[Building] Remove Tile',
    EditRooms = '[Building] Edit Rooms',
    EditTiles = '[Building] Edit Tiles',
    PaintTileCells = '[Building] Paint Tile Cells',
    TransformSelection = '[Building] Transform Selection',
    EditFloor = '[Building] Edit Floor',
    EditRoomDefinitions = '[Building] Edit Room Definitions',

    SetTileCount = '[Loading] Set Tile Count',

    TogglePopup = '[Popup] Toggle Popup',

    SetCurrentTool = '[Grid] Set Current Tool',
    SetSelectedFurniture = '[Grid] Set Selected Furniture',
    ScheduleRedraw = '[Grid] Schedule Redraw'
}

//Building
export class SetBuilding implements Action {
    readonly type = ActionTypes.SetBuilding;

    constructor(public building: Building) {
        const used = new Set<string>();
        this.building = {
            ...building,
            floors: building.floors.map(floor => ({
                ...floor,
                objects: floor.objects.map(object => {
                    let uid = object.uid;
                    if (typeof uid !== 'string' || !uid || used.has(uid)) uid = GUID.generateGUID();
                    used.add(uid);
                    return { ...object, uid };
                }),
            })),
        };
    }
}

export class AddObject implements Action {
    readonly type = ActionTypes.AddObject;

    constructor(public obj: any, public level: number, public furnitureDefinition?: Furniture) {
        this.obj = { ...obj, uid: typeof obj.uid === 'string' && obj.uid ? obj.uid : GUID.generateGUID() };
    }
}

export class UpdateObject implements Action {
    readonly type = ActionTypes.UpdateObject;

    constructor(public uid: string, public changes: Record<string, unknown>) { }
}

export class RemoveObject implements Action {
    readonly type = ActionTypes.RemoveObject;

    constructor(public uid: string) { }
}

export class RemoveObjects implements Action {
    readonly type = ActionTypes.RemoveObjects;
    constructor(public uids: string[]) { }
}

export class Undo implements Action { readonly type = ActionTypes.Undo; }
export class Redo implements Action { readonly type = ActionTypes.Redo; }

export class EditFloor implements Action {
    readonly type = ActionTypes.EditFloor;
    constructor(public operation: 'add' | 'duplicate' | 'remove' | 'up' | 'down', public level: number) { }
}

export class EditRoomDefinitions implements Action {
    readonly type = ActionTypes.EditRoomDefinitions;
    constructor(public originalRooms: Room[], public drafts: RoomDefinitionDraft[], public level: number) {
        this.drafts = drafts.map(draft => ({ ...draft, room: { ...draft.room }, ...(draft.materials ? {
            materials: Object.fromEntries(Object.entries(draft.materials).map(([key, entry]) => [key, entry ? cloneRoomEntry(entry) : null])) } : {}) }));
    }
}

export class PaintTileCells implements Action {
    readonly type = ActionTypes.PaintTileCells;
    constructor(public level: number, public layer: string, public cells: TileCellEdit[]) { }
}
export class TransformSelection implements Action {
    readonly type = ActionTypes.TransformSelection;
    constructor(public edit: SelectionEdit) { }
    get level(): number { return this.edit.level; }
}

export class EditRooms implements Action {
    readonly type = ActionTypes.EditRooms;
    constructor(public area: TileArea, public level: number, public room: number) { }
}

export class EditTiles implements Action {
    readonly type = ActionTypes.EditTiles;
    constructor(public area: TileArea, public level: number, public layer: string, public tile: string | null) { }
}

export class AddRoom implements Action {
    readonly type = ActionTypes.AddRoom;

    constructor(public x: number, public y: number, public level: number, public room: number) { }
}

export class RemoveRoom implements Action {
    readonly type = ActionTypes.RemoveRoom;

    constructor(public x: number, public y: number, public level: number, public room: number) { }
}

export class AddTile implements Action {
    readonly type = ActionTypes.AddTile;

    constructor(public x: number, public y: number, public level: number, public layer: string, public url: string) { }
}

export class RemoveTile implements Action {
    readonly type = ActionTypes.RemoveTile;

    constructor(public x: number, public y: number, public level: number, public layer: string) { }
}

//Loading
export class SetTileCount implements Action {
    readonly type = ActionTypes.SetTileCount;

    constructor(public tileCount: number) { }
}

//Popups
export class TogglePopup implements Action {
    readonly type = ActionTypes.TogglePopup;

    constructor(public popupName: string, public open: boolean) { }
}

//Other

export class SetCurrentTool implements Action {
    readonly type = ActionTypes.SetCurrentTool;

    constructor(public tool: string) { }
}

export class SetSelectedFurniture implements Action {
    readonly type = ActionTypes.SetSelectedFurniture;

    constructor(public furniture: VisualFurniture, public orient: string) { }
}

export class ScheduleRedraw implements Action {
    readonly type = ActionTypes.ScheduleRedraw;

    constructor(public schedule: boolean) {}
}

export type ActionsUnion = 
    SetCurrentTool |
    SetSelectedFurniture |
    ScheduleRedraw |
    SetBuilding |
    AddObject |
    UpdateObject |
    RemoveObject |
    RemoveObjects |
    Undo |
    Redo |
    AddRoom |
    RemoveRoom |
    AddTile |
    RemoveTile |
    EditRooms |
    EditTiles |
    PaintTileCells |
    TransformSelection |
    EditFloor |
    EditRoomDefinitions |
    SetTileCount |
    TogglePopup
    ;
