import { Injectable } from "@angular/core";
import { SvgObject } from "../models/app.models";
import { TileService } from "./tile.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { BuildingService } from "./building.service";
import { GridService } from "./grid.service";
import { AddObject, RemoveObject } from "../app.actions";
import { GUID } from "../utils/guid";
import { canPlaceObject } from '../utils/tool-placement';

@Injectable({
    providedIn: 'root',
  })
export class WindowService {

    constructor(private gridService: GridService, private buildingService: BuildingService, private store: Store<fromRoot.State>) { 
        
    }

    placeWindow(x: number, y: number, level: number, orient: string) 
    {
        const building = this.buildingService.building;
        if (!canPlaceObject(building, x, y, level) || !['N', 'W'].includes(orient)) return;

        const newWindow = {
            uid: GUID.generateGUID(),
            type: 'window',
            CurtainsTile: building.Curtains,
            ShuttersTile: building.Shutters,
            x: x,
            y: y,
            dir: orient,
            Tile: building.Window
        };

        this.store.dispatch(new AddObject(newWindow, level));

    }

    removeWindow(uid: string): void {
        this.store.dispatch(new RemoveObject(uid));
    }

    getTile(dir: 'N' | 'W'): string | undefined {
        const building = this.buildingService.building;
        return building?.entries[building.Window - 1]?.tiles.find(tile => tile.enum === (dir === 'N' ? 'North' : 'West'))?.tile;
    }
}
