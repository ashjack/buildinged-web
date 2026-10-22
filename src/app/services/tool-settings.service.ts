import { Injectable } from '@angular/core';
import { TileCellEdit } from '../utils/selection-edits';
import { Subject } from 'rxjs';
import { TileEntry } from '../models/app.models';

export type TileEditMode = 'rectangle' | 'brush' | 'eraser' | 'fill' | 'pick' | 'capture';
@Injectable({ providedIn: 'root' })
export class ToolSettingsService {
    readonly pickedTileChanges = new Subject<string>();
    tileMode: TileEditMode = 'rectangle';
    stamp: { width: number; height: number; cells: TileCellEdit[] } | undefined;
    exterior: number | null = null;
    wallMaterials: Record<string, TileEntry | null> = {};
    interior: number | null = null;
    exteriorTrim: number | null = null;
    interiorTrim: number | null = null;
    stairs: number | null = null;
    message = '';
}
