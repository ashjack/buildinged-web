import { Injectable, NgZone, Optional } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { BFurnitureGroup, FurnitureDocument } from '../models/furniture-window.models';
import { parseFurnitureDocument } from '../utils/furniture-catalog-parser';
import { PublishedLibrary, PublishedTextLibrary } from './published-text-library';

/** Published by the admin furniture editor. Until the first save, the bundled copy is used. */
export const FURNITURE_URL = 'https://storage.googleapis.com/buildinged-online.appspot.com/BuildingFurniture.txt';
export const BUNDLED_FURNITURE_URL = 'assets/BuildingFurniture.txt';

export type FurnitureLibrary = PublishedLibrary<FurnitureDocument>;

/** The one furniture list every part of the app reads. */
@Injectable({ providedIn: 'root' })
export class FurnitureLibraryService extends PublishedTextLibrary<FurnitureDocument> {
  readonly groups$: Observable<BFurnitureGroup[]> = this.library$.pipe(map(library => library.document.groups));

  constructor(http: HttpClient, @Optional() zone?: NgZone) {
    super(http, { url: FURNITURE_URL, bundledUrl: BUNDLED_FURNITURE_URL, channel: 'buildinged-furniture', description: 'furniture list',
      parse: parseFurnitureDocument }, zone);
  }
}
