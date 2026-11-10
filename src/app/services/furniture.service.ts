import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { BuildingService } from "./building.service";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { AddObject } from "../app.actions";
import { VisualFurniture } from "../models/furniture-window.models";
import { take } from "rxjs";
import { GUID } from "../utils/guid";
import { furnitureDefinition, furnitureEntryForPlacement, furnitureEntrySize, wallFurnitureFits } from "../utils/furniture-definition";
import { canPlaceObject } from '../utils/tool-placement';

@Injectable({
    providedIn: 'root',
  })
export class FurnitureService {
    constructor(private db: DbService, private buildingService: BuildingService,  private store: Store<fromRoot.State>) { }

    placeFurniture(x: number, y: number, level: number, orient: string, furniture: VisualFurniture) {
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(b => {
            const entry = furnitureEntryForPlacement(furniture, orient), size = furnitureEntrySize(entry);
            if (!entry || !canPlaceObject(b, x, y, level, size.width, size.height)) return;
            if (furniture.layer === 'Walls' && !wallFurnitureFits(b!, x, y, orient, size)) return;
        
            const uid = GUID.generateGUID();
            const definition = furnitureDefinition(furniture);
            const newFurniture = {
                uid: uid,
                type: 'furniture',
                x: x,
                y: y,
                orient: orient
            };
    
            this.store.dispatch(new AddObject(newFurniture, level, definition));
    
    
        });
    }
    
}
