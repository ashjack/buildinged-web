import { Component } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SvgTile } from '../models/app.models';


@Component({
  selector: 'app-tile-selection-menu',
  templateUrl: './tile-selection-menu.component.html',
  styleUrls: ['./tile-selection-menu.component.scss']
})
export class TileSelectionMenuComponent {
  constructor(private sanitizer: DomSanitizer) { }

  getIndividualTiles(): SvgTile[] {
    const individualTiles: SvgTile[] = [];
  
    for (let i = 0; i < 64; i++) { // Replace `numTiles` with the number of tiles you have
      const tileName = `tile_${i}.png`;
      const tileUrl = localStorage.getItem(tileName);
      if (tileUrl) {
        const sanitizedTile = this.sanitizer.bypassSecurityTrustResourceUrl(tileUrl);
        individualTiles.push({
          name: tileName,
          url: sanitizedTile,
          x: 0,
          y: 0
        });
      }
    }
  
    return individualTiles;
  }

  setSelectedTile(tileName: string) {
    console.log(tileName);
    localStorage.setItem('selectedTile', tileName);
  }

  getSelectedTile(): string {
    return localStorage.getItem('selectedTile') || 'tile_0.png';
  }
}
