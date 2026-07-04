import { Component, OnInit } from "@angular/core";
import { Observable } from "rxjs";
import { TileDownloadProgress, TileService } from "src/app/services/tile.service";

@Component({
    selector: 'app-tile-download-window',
    templateUrl: './tile-download-window.component.html',
    styleUrls: ['./tile-download-window.component.scss']
  })
  export class TileDownloadWindowComponent implements OnInit{
      constructor(private tileService: TileService) { } 

    progress$: Observable<TileDownloadProgress>;

    totalTiles: number;
    processedTiles: number;
    currentPackName: string = '';
    currentSheetName: string = '';
    loading: boolean = false;

  ngOnInit(): void {
    this.progress$ = this.tileService.progress$;

    this.progress$.subscribe((progress) => {
      this.loading = progress.active;
      this.totalTiles = progress.totalTiles;
      this.processedTiles = progress.processedTiles;
      this.currentPackName = progress.currentPackName ?? '';
      this.currentSheetName = progress.currentSheetName ?? '';
    });
  }
}