import { Action } from "@ngrx/store";

export enum ActionTypes {
    SetCurrentTool = '[Grid] Set Current Tool',
    ScheduleRedraw = '[Grid] Schedule Redraw'
}

export class SetCurrentTool implements Action {
    readonly type = ActionTypes.SetCurrentTool;

    constructor(public tool: string) { }
}

export class ScheduleRedraw implements Action {
    readonly type = ActionTypes.ScheduleRedraw;

    constructor(public schedule: boolean) {}
}

export type ActionsUnion = SetCurrentTool |
                            ScheduleRedraw;
