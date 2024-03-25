import { Component, OnInit } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { Observable, interval } from "rxjs";
import { TileService } from "src/app/services/tile.service";
import * as fromRoot from '../../app.reducers';
import { Store } from "@ngrx/store";

@Component({
    selector: 'app-tile-download-window',
    templateUrl: './tile-download-window.component.html',
    styleUrls: ['./tile-download-window.component.scss']
  })
  export class TileDownloadWindowComponent implements OnInit{
    constructor(private sanitizer: DomSanitizer, private tileService: TileService, private store: Store<fromRoot.State>,) { } 

    tileCount$: Observable<number>;

    totalTiles: number;
    processedTiles: number;
    loading: boolean = false;

  ngOnInit(): void {
    this.tileCount$ = this.store.select(fromRoot.getTileCount);

    let finishCount = 0;

    interval(1000).subscribe(() => {
      if(this.totalTiles == this.processedTiles)
      {
        finishCount++;
      }
      else
      {
        this.totalTiles = this.tileService.totalTiles;
        this.processedTiles = this.tileService.processedTiles;
        finishCount = 0;
      }

      if(finishCount > 7)
      {
        this.loading = false;
      }
  });
  }
}