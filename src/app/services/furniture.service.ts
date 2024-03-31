import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { Furniture, TileEntry } from "../models/app.models";
import { BuildingService } from "./building.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { AddObject } from "../app.actions";
import { VisualFurniture } from "../models/furniture-window.models";

@Injectable({
    providedIn: 'root',
  })
export class FurnitureService {
    constructor(private db: DbService, private buildingService: BuildingService,  private store: Store<fromRoot.State>) { }

    placeFurniture(x: number, y: number, level: number, orient: string, furniture: VisualFurniture) 
    {
        const building = this.buildingService.building;
        console.log(furniture)

        const newFurniture = {
            type: 'furniture',
            x: x,
            y: y,
            orient: orient,
            FurnitureTiles: furniture.entries
        };

        this.store.dispatch(new AddObject(newFurniture, level));

        const newFurnitureToPlace = {
            type: 'furniture',
            x: x,
            y: y,
            orient: orient,
            FurnitureTiles: building.furniture.length
        };

        this.buildingService.placeTile(newFurnitureToPlace, level);
    }
}