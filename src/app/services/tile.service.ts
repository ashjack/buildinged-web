import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { HttpClient } from "@angular/common/http";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { SetTileCount } from "../app.actions";
import { Tilepack } from "../models/app.models";

@Injectable({
    providedIn: "root",
})
export class TileService {

    constructor(private db: DbService, private http: HttpClient, private store: Store<fromRoot.State>) { }

    failedDecodes: string[] = [];
    totalTiles = 0;
    processedTiles = 0;

    tilepacks: Tilepack[] = [];

    async saveTilesetToIndexedDb(name: string, url: string) {

    }

    async processTilepacks(tilepacks: Tilepack[], index: number) {
      if (index >= tilepacks.length) {
        console.log(this.failedDecodes);
        return;
      }
    
      const tilepack = tilepacks[index];
      const existingTilepack = localStorage.getItem(tilepack.name)
      if(existingTilepack)
      {
        tilepack.enabled = true;
      }
    
      if(tilepack.enabled || index == 0)
      {
        this.http.get(tilepack.url).subscribe((data2: any) => {
          this.processTilesheets(data2, tilepack.name, index);
        });
      }
    }
    
    processTilesheets(tilesheets: any[], packName: string, index: number) {
      if (index >= tilesheets.length) {
        // Proceed to the next tilepack
        this.processTilepacks(this.tilepacks, index + 1);
        return;
      }
    
      const tilesheet = tilesheets[index];
      const tilesheetName = tilesheet.name;
      const tilesheetUrl = tilesheet.url;
    
      this.saveTilesToCache(tilesheetName, tilesheetUrl, packName)
        .then(() => {
          // Process the next tilesheet
          this.processTilesheets(tilesheets, packName, index + 1);
        })
        .catch((error) => {
          console.error('Error processing tilesheet:', error);
          // Proceed to the next tilesheet
          this.processTilesheets(tilesheets, packName, index + 1);
        });
    }

    fetchTilesheet(url: string) {
        const tilesheetUrl = url;//'assets/tilesheets/walls_exterior_house_01.png';
        return this.http.get(tilesheetUrl, { responseType: 'blob' });
      }
    
      async splitTilesheet(url: string) {
        try {
            const tilesheetBlob: Blob | undefined = await this.fetchTilesheet(url).toPromise();
            const tilesheetUrl: string = URL.createObjectURL(tilesheetBlob!);
    
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
    
            const image = new Image();
            image.src = tilesheetUrl;
            await image.decode();
    
            const tileWidth = 128;  // Adjust this based on the actual tile width in pixels
            const tileHeight = 256; // Adjust this based on the actual tile height in pixels
    
            const numTilesX = Math.floor(image.width / tileWidth);
            const numTilesY = Math.floor(image.height / tileHeight);

            this.totalTiles += numTilesX * numTilesY;
    
            const individualTiles = [];
    
            for (let y = 0; y < numTilesY; y++) {
                for (let x = 0; x < numTilesX; x++) {
                    canvas.width = tileWidth;
                    canvas.height = tileHeight;
    
                    context?.drawImage(
                        image,
                        x * tileWidth,
                        y * tileHeight,
                        tileWidth,
                        tileHeight,
                        0,
                        0,
                        tileWidth,
                        tileHeight
                    );
    
                    const dataUrl = canvas.toDataURL('image/png');
                    individualTiles.push(dataUrl);
                }
            }
    
            return individualTiles;
        } catch (e) {
            console.log(url, e);
            this.failedDecodes.push(url);
            return [];
        }
    }
    
    
      hasHiddenLoading = false;
      async saveTilesToCache(sheetName: string, sheetPath: string, packName: string) {

        const hasTileset = await this.db.hasTileset(sheetName);
        if (hasTileset) {
          console.log(`Tileset ${sheetName} already exists in cache`);
          if(!this.hasHiddenLoading)
          {
            this.hasHiddenLoading = true;
            this.store.dispatch(new SetTileCount(-1));
          }
          return;
        }

        console.log(`Getting tileset ${sheetName}`)
        await this.db.addTileset(sheetName, sheetPath, packName);

        await this.splitTilesheet(sheetPath).then((tiles: string[]) => {
          tiles.forEach(async (tile: string, index: number) => {
            const threeDigitIndex = index.toString().padStart(3, '0');
            const tileName = `${sheetName}_${threeDigitIndex}.png`
      
            // Save the tile URL as a string to the browser cache (local storage)
            await this.db.addTile(tileName, tile, sheetName).then(() => {
              console.log(`Added ${tileName} to cache`);
              this.processedTiles += 1;
            });
          });
        });
      }

      //Calculate the pixel area of each tile in the tilesheet
      

}