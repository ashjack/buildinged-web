import { Action } from "@ngrx/store";
import { Building } from "./models/app.models";

export enum ActionTypes {
    SetBuilding = '[Building] Set Building',
    AddObject = '[Building] Add Object',
    RemoveObject = '[Building] Remove Object',
    AddRoom = '[Building] Add Room',
    RemoveRoom = '[Building] Remove Room',
    AddTile = '[Building] Add Tile',
    RemoveTile = '[Building] Remove Tile',

    SetTileCount = '[Loading] Set Tile Count',

    TogglePopup = '[Popup] Toggle Popup',

    SetCurrentTool = '[Grid] Set Current Tool',
    ScheduleRedraw = '[Grid] Schedule Redraw'
}

//Building
export class SetBuilding implements Action {
    readonly type = ActionTypes.SetBuilding;

    constructor(public building: Building) { }
}

export class AddObject implements Action {
    readonly type = ActionTypes.AddObject;

    constructor(public obj: any, public level: number) { }
}

export class RemoveObject implements Action {
    readonly type = ActionTypes.RemoveObject;

    constructor(public obj: any, public level: number) { }
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

export class ScheduleRedraw implements Action {
    readonly type = ActionTypes.ScheduleRedraw;

    constructor(public schedule: boolean) {}
}

export type ActionsUnion = 
    SetCurrentTool |
    ScheduleRedraw |
    SetBuilding |
    AddObject |
    RemoveObject |
    AddRoom |
    RemoveRoom |
    AddTile |
    RemoveTile |
    SetTileCount |
    TogglePopup
    ;
