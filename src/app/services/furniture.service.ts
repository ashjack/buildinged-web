import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { Furniture, TileEntry } from "../models/app.models";

@Injectable({
    providedIn: 'root',
  })
export class FurnitureService {
    constructor(private db: DbService) { }

    furniture: Furniture[] = [];
    objects: any[] = [];
    tileEntries: TileEntry[] = [];

}