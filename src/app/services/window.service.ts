import { Injectable } from "@angular/core";
import { SvgObject } from "../models/app.models";
import { TileService } from "./tile.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { BuildingService } from "./building.service";
import { GridService } from "./grid.service";
import { AddObject, RemoveObject } from "../app.actions";

@Injectable({
    providedIn: 'root',
  })
export class WindowService {

    constructor(private gridService: GridService, private buildingService: BuildingService, private store: Store<fromRoot.State>) { 
        
    }

    placeWindow(x: number, y: number, level: number, orient: string) 
    {
        const building = this.buildingService.building;

        const newWindow = {
            type: 'window',
            CurtainsTile: building.Curtains,
            ShuttersTile: building.Shutters,
            x: x,
            y: y,
            dir: orient,
            Tile: building.Window
        };

        this.store.dispatch(new AddObject(newWindow, level));
        this.buildingService.placeTile(newWindow, level);
    }

    removeWindow(x: number, y: number, level: number, orient: string)
    {
        const building = this.buildingService.building;

        const newWindow = {
            type: 'window',
            x: x,
            y: y,
            dir: orient,
        };

        //this.store.dispatch(new RemoveObject)
    }
}