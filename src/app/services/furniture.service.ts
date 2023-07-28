import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { Furniture } from "../models/app.models";

@Injectable({
    providedIn: 'root',
  })
export class FurnitureService {
    constructor(private db: DbService) { }

    furniture: Furniture[] = [];
}