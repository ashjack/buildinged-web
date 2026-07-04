import { Injectable } from "@angular/core";
import { DbService } from "./db.service";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Tilepack } from "../models/app.models";
import { BehaviorSubject, firstValueFrom } from "rxjs";
import { JSZipObject } from "jszip";

export interface TileDownloadProgress {
  active: boolean;
  totalTiles: number;
  processedTiles: number;
  currentPackName?: string;
  currentSheetName?: string;
  failedSheets: number;
}

@Injectable({
    providedIn: "root",
})
export class TileService {

  constructor(private db: DbService, private http: HttpClient) { }

    failedDecodes: string[] = [];
    totalTiles = 0;
    processedTiles = 0;
    isDownloading = false;

    private progressSubject = new BehaviorSubject<TileDownloadProgress>({
      active: false,
      totalTiles: 0,
      processedTiles: 0,
      failedSheets: 0,
    });
    readonly progress$ = this.progressSubject.asObservable();

    tilepacks: Tilepack[] = [];

    async saveTilesetToIndexedDb(name: string, url: string) {

    }

    private beginProgress(): void {
      this.failedDecodes = [];
      this.totalTiles = 0;
      this.processedTiles = 0;
      this.progressSubject.next({
        active: true,
        totalTiles: 0,
        processedTiles: 0,
        failedSheets: 0,
      });
    }

    private updateProgress(partial: Partial<TileDownloadProgress> = {}): void {
      const current = this.progressSubject.getValue();
      this.progressSubject.next({
        ...current,
        totalTiles: this.totalTiles,
        processedTiles: this.processedTiles,
        ...partial,
      });
    }

    private endProgress(): void {
      this.updateProgress({
        active: false,
        currentPackName: undefined,
        currentSheetName: undefined,
        failedSheets: this.failedDecodes.length,
      });
    }

    async processTilepacks(tilepacks: Tilepack[], tilepackIndex: number) {
      if (this.isDownloading) {
        console.warn('Tile download already in progress, skipping new request.');
        return;
      }

      this.isDownloading = true;
      this.beginProgress();

      try {
        for (let index = tilepackIndex; index < tilepacks.length; index++) {
          const tilepack = tilepacks[index];
          const enabledInStorage = localStorage.getItem(tilepack.name) === '1';
          tilepack.enabled = tilepack.enabled || enabledInStorage;

          if (!(tilepack.enabled || index === 0)) {
            continue;
          }

          this.updateProgress({ currentPackName: tilepack.name, currentSheetName: undefined });

          const headers = new HttpHeaders().set('Cache-Control', 'no-cache');

          if (tilepack.url.toLowerCase().endsWith('.zip')) {
            try {
              await this.processZipTilepack(tilepack.url, tilepack.name, headers);
            } catch (error) {
              console.error('Error processing zip tilepack:', error);
              this.failedDecodes.push(tilepack.url);
              this.updateProgress({ failedSheets: this.failedDecodes.length });
            }
            continue;
          }

          let tilesheets: any[] = [];

          try {
            tilesheets = await firstValueFrom(this.http.get<any[]>(tilepack.url, { headers }));
          } catch (error) {
            console.error('Error loading tilepack:', error);
            this.failedDecodes.push(tilepack.url);
            this.updateProgress({ failedSheets: this.failedDecodes.length });
            continue;
          }

          await this.processTilesheets(tilesheets, tilepack.name);
        }
      } finally {
        this.isDownloading = false;
        this.endProgress();
        console.log(this.failedDecodes);
      }
    }

    private async processZipTilepack(zipUrl: string, packName: string, headers: HttpHeaders): Promise<void> {
      const jszipModule: any = await import('jszip');
      const JSZipLib = jszipModule.default ?? jszipModule;
      const zipBuffer = await firstValueFrom(this.http.get(zipUrl, { headers, responseType: 'arraybuffer' }));
      const zip = await JSZipLib.loadAsync(zipBuffer);
      const tilesheetEntries = this.getZipTilesheetEntries(zip);

      for (const entry of tilesheetEntries) {
        const sheetName = this.getTilesheetName(entry.name);
        this.updateProgress({ currentPackName: packName, currentSheetName: sheetName });

        try {
          await this.saveZipTilesheetToCache(sheetName, entry, packName);
        } catch (error) {
          console.error('Error processing zip tilesheet:', error);
          this.failedDecodes.push(entry.name);
          this.updateProgress({ failedSheets: this.failedDecodes.length });
        }
      }
    }

    private getZipTilesheetEntries(zip: { files: { [key: string]: JSZipObject } }): JSZipObject[] {
      const files = Object.values(zip.files) as JSZipObject[];
      return files
        .filter(file => !file.dir && /(^|\/)Tiles\/2x\/.+\.png$/i.test(file.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    private getTilesheetName(path: string): string {
      const filename = path.split('/').pop() ?? path;
      return filename.replace(/\.png$/i, '');
    }

    private async saveZipTilesheetToCache(sheetName: string, file: JSZipObject, packName: string): Promise<void> {
      const hasTileset = await this.db.hasTileset(sheetName);
      if (hasTileset) {
        console.log(`Tileset ${sheetName} already exists in cache`);
        return;
      }

      const sheetBlob = await file.async('blob');
      await this.db.addTileset(sheetName, file.name, packName);
      await this.splitTilesheetBlob(sheetBlob, sheetName);
    }
    
    async processTilesheets(tilesheets: any[], packName: string) {
      for (const tilesheet of tilesheets) {
        const tilesheetName = tilesheet.name;
        const tilesheetUrl = tilesheet.url;

        this.updateProgress({ currentPackName: packName, currentSheetName: tilesheetName });

        try {
          await this.saveTilesToCache(tilesheetName, tilesheetUrl, packName);
        } catch (error) {
          console.error('Error processing tilesheet:', error);
          this.failedDecodes.push(tilesheetUrl);
          this.updateProgress({ failedSheets: this.failedDecodes.length });
        }
      }
    }

    fetchTilesheet(url: string) {
        const tilesheetUrl = url;//'assets/tilesheets/walls_exterior_house_01.png';
        return this.http.get(tilesheetUrl, { responseType: 'blob' });
      }

      async splitTilesheet(url: string, sheetName: string) {
        const tilesheetBlob: Blob = await firstValueFrom(this.fetchTilesheet(url));
        return this.splitTilesheetBlob(tilesheetBlob, sheetName);
      }

      async splitTilesheetBlob(tilesheetBlob: Blob, sheetName: string) {
        try {
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

            const tilesInSheet = numTilesX * numTilesY;
            this.totalTiles += tilesInSheet;
            this.updateProgress();

            const batch: { name: string; url: string; tileset: string }[] = [];
            const batchSize = 48;
            let tileIndex = 0;

            canvas.width = tileWidth;
            canvas.height = tileHeight;
    
            for (let y = 0; y < numTilesY; y++) {
                for (let x = 0; x < numTilesX; x++) {
                context?.clearRect(0, 0, tileWidth, tileHeight);
    
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

                    const threeDigitIndex = tileIndex.toString().padStart(3, '0');
                    const tileName = `${sheetName}_${threeDigitIndex}.png`;
                    batch.push({
                      name: tileName,
                      url: dataUrl,
                      tileset: sheetName,
                    });
                    tileIndex++;

                    if (batch.length >= batchSize) {
                      const completedBatch = batch.splice(0, batch.length);
                      await this.db.bulkUpsertTiles(completedBatch);
                      this.processedTiles += completedBatch.length;
                      this.updateProgress();
                    }
                }
            }

            if (batch.length) {
              const remaining = batch.length;
              await this.db.bulkUpsertTiles(batch);
              this.processedTiles += remaining;
              this.updateProgress();
            }

            URL.revokeObjectURL(tilesheetUrl);
            return;
        } catch (e) {
            console.log(sheetName, e);
            this.failedDecodes.push(sheetName);
            this.updateProgress({ failedSheets: this.failedDecodes.length });
            return;
        }
    }

      async saveTilesToCache(sheetName: string, sheetPath: string, packName: string) {

        const hasTileset = await this.db.hasTileset(sheetName);
        if (hasTileset) {
          console.log(`Tileset ${sheetName} already exists in cache`);
          return;
        }

        console.log(`Getting tileset ${sheetName}`)
        await this.db.addTileset(sheetName, sheetPath, packName);

        await this.splitTilesheet(sheetPath, sheetName);
      }

      //Calculate the pixel area of each tile in the tilesheet
      

}