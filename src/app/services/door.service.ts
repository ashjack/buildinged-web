import { Injectable } from "@angular/core";
import { Building, SvgObject } from "../models/app.models";
import { TileService } from "./tile.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { BuildingService } from "./building.service";
import { GridService } from "./grid.service";
import { AddObject } from "../app.actions";

@Injectable({
    providedIn: 'root',
  })
export class DoorService {

    //building: Building;

    constructor(private gridService: GridService, private buildingService: BuildingService, private store: Store<fromRoot.State>) { 
        
    }

    placeDoor(x: number, y: number, level: number, orient: string) 
    {
        const building = this.buildingService.building;

        const newDoor = {
            type: 'door',
            FrameTile: building.DoorFrame,
            x: x,
            y: y,
            dir: orient,
            Tile: building.Door
        };

        //building.floors[level].objects = [...building.floors[level].objects, newDoor];
        this.store.dispatch(new AddObject(newDoor, level));
        this.buildingService.placeTile(newDoor, level);

        //this.buildingService.drawBuilding();
    }
}