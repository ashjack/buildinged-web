import { Action } from "@ngrx/store";
import { Building } from "./models/app.models";

export enum ActionTypes {
    SetBuilding = '[Building] Set Building',
    AddObject = '[Building] Add Object',

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
    AddObject
    ;
