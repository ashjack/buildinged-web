import { Injectable } from "@angular/core";
import { Building, SvgObject } from "../models/app.models";
import { TileService } from "./tile.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { BuildingService } from "./building.service";
import { GridService } from "./grid.service";
import { AddObject } from "../app.actions";
import { GUID } from "../utils/guid";
import { canPlaceObject } from '../utils/tool-placement';

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
        if (!canPlaceObject(building, x, y, level) || !['N', 'W'].includes(orient)) return;

        const newDoor = {
            uid: GUID.generateGUID(),
            type: 'door',
            FrameTile: building.DoorFrame,
            x: x,
            y: y,
            dir: orient,
            Tile: building.Door
        };

        //building.floors[level].objects = [...building.floors[level].objects, newDoor];
        this.store.dispatch(new AddObject(newDoor, level));


        //this.buildingService.drawBuilding();
    }

    getTile(dir: 'N' | 'W'): string | undefined {
        const building = this.buildingService.building;
        return building?.entries[building.Door - 1]?.tiles.find(tile => tile.enum === (dir === 'N' ? 'North' : 'West'))?.tile;
    }
}
