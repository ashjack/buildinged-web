import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { HttpClient } from "@angular/common/http";

@Injectable({
    providedIn: "root",
})
export class TileService {

    constructor(private db: DbService, private http: HttpClient) { }

    async saveTilesetToIndexedDb(name: string, url: string) {

    }

    fetchTilesheet(url: string) {
        const tilesheetUrl = url;//'assets/tilesheets/walls_exterior_house_01.png';
        return this.http.get(tilesheetUrl, { responseType: 'blob' });
      }
    
      async splitTilesheet(url: string) {
        try{
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
      }
      catch(e)
      {
        console.log(url, e);
        return [];
      }
    }
    
      async saveTilesToCache(sheetName: string, sheetPath: string) {
        //const sheetName = 'walls_exterior_house_01';
        //const sheetPath = 'assets/tilesheets/walls_exterior_house_01.png';

        await this.db.addTileset(sheetName, sheetPath);

        await this.splitTilesheet(sheetPath).then((tiles: string[]) => {
          tiles.forEach((tile: string, index: number) => {
            const threeDigitIndex = index.toString().padStart(3, '0');
            const tileName = `${sheetName}_${threeDigitIndex}.png`
      
            // Save the tile URL as a string to the browser cache (local storage)
            //localStorage.setItem(tileName, tile);
            this.db.addTile(tileName, tile, sheetName);
            console.log(`Saved ${tileName} to cache`);
          });
        });
      }

      //Calculate the pixel area of each tile in the tilesheet
      

}