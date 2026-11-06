import { Injectable, NgZone, Optional } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { TileEntry } from '../models/app.models';
import { BuildingTilesDocument, parseBuildingTilesDocument, toTileEntries } from '../utils/building-tiles';
import { PublishedLibrary, PublishedTextLibrary } from './published-text-library';

/** Published by the admin page. Until the first save, the bundled copy is used. */
export const BUILDING_TILES_URL = 'https://storage.googleapis.com/buildinged-online.appspot.com/BuildingTiles.txt';
export const BUNDLED_BUILDING_TILES_URL = 'assets/BuildingTiles.txt';

export type BuildingTilesLibrary = PublishedLibrary<BuildingTilesDocument>;

/** The wall, floor, door, roof... materials (BuildingTiles.txt) every editor offers. */
@Injectable({ providedIn: 'root' })
export class BuildingTilesLibraryService extends PublishedTextLibrary<BuildingTilesDocument> {
  readonly entries$: Observable<TileEntry[]> = this.library$.pipe(map(library => toTileEntries(library.document)),
    shareReplay({ bufferSize: 1, refCount: true }));

  constructor(http: HttpClient, @Optional() zone?: NgZone) {
    super(http, { url: BUILDING_TILES_URL, bundledUrl: BUNDLED_BUILDING_TILES_URL, channel: 'buildinged-building-tiles',
      description: 'building tiles list', parse: parseBuildingTilesDocument }, zone);
  }
}
