import { Action } from "@ngrx/store";

export enum ActionTypes {
    SetCurrentTool = '[Grid] Set Current Tool'
}

export class SetCurrentTool implements Action {
    readonly type = ActionTypes.SetCurrentTool;

    constructor(public tool: string) { }
}

export type ActionsUnion = SetCurrentTool;
