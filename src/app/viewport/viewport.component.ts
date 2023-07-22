import { Component, AfterViewInit, ViewChild, ElementRef, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SvgTile } from '../models/app.models';

@Component({
  selector: 'app-viewport',
  templateUrl: './viewport.component.html',
  styleUrls: ['./viewport.component.scss']
})
export class ViewportComponent implements OnInit{

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) { }

  rowArray = Array(10).fill(0).map((x,i)=>i);
  colArray = Array(10).fill(0).map((x,i)=>i);

  tiles: SvgTile[] = [];
  tileGhosts: SvgTile[] = [];
  dragTiles: SvgTile[] = [];
  beginDragCoords: number[] = [];
  isDragging: boolean = false;

  selectedTile: string = 'tile_0.png';

  ngOnInit() {
    this.saveTilesToCache();
  }

  hoverTile(x: number, y: number) {

    this.selectedTile = localStorage.getItem('selectedTile')!;

    if(this.isDragging)
    {
      this.dragTiles = [];
      const x1 = this.beginDragCoords[0];
      const y1 = this.beginDragCoords[1];
      const x2 = x;
      const y2 = y;
      const xMin = Math.min(x1, x2);
      const xMax = Math.max(x1, x2);
      const yMin = Math.min(y1, y2);
      const yMax = Math.max(y1, y2);
      for(let i = xMin; i <= xMax; i++)
      {
        for(let j = yMin; j <= yMax; j++)
        {
          const tile: SvgTile = {
            name: this.selectedTile,
            url: this.getIndividualTile(this.selectedTile),
            x: i,
            y: j
          };
          this.dragTiles.push(tile);
        }
      }
    }

    this.tileGhosts = [];
    const tile: SvgTile = {
      name: this.selectedTile,
      url: this.getIndividualTile(this.selectedTile),
      x: x,
      y: y
    };
    this.tileGhosts.push(tile);
  }

  beginDrag($event: MouseEvent, x: number, y: number)
  {
    if($event.button != 0)
    {
      return;
    }
    console.log("drag");
    this.beginDragCoords = [x, y];
    this.isDragging = true;
  }

  endDrag($event: MouseEvent, x: number, y: number)
  {
    if($event.button != 0)
    {
      return;
    }

    //Place every tile between beginDrag and endDrag in the dragTiles array
    this.isDragging = false;
    this.dragTiles = [];
    const x1 = this.beginDragCoords[0];
    const y1 = this.beginDragCoords[1];
    const x2 = x;
    const y2 = y;
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);
    for(let i = xMin; i <= xMax; i++)
    {
      for(let j = yMin; j <= yMax; j++)
      {
        /*const tile: SvgTile = {
          name: this.selectedTile,
            url: this.getIndividualTile(this.selectedTile),
          x: i,
          y: j
        };
        this.tiles.push(tile);*/
        this.placeTile(i, j);
      }
    }
  }

  placeTile(x: number, y: number) {

    if(this.tileExists(x, y))
    {
      //edit tile name and url
      const tile = this.getTileAt(x, y);
      if(tile)
      {
        tile.name = this.selectedTile;
        tile.url = this.getIndividualTile(this.selectedTile);
        return;
      }
    }
    const tile: SvgTile = {
      name: this.selectedTile,
            url: this.getIndividualTile(this.selectedTile),
      x: x,
      y: y
    };
    this.tiles.push(tile);
    this.tileGhosts = [];
  }

  getTileAt(x: number, y: number): SvgTile | undefined {
    return this.tiles.find((tile: SvgTile) => {
      return tile.x === x && tile.y === y;
    });
  }

  tileExists(x: number, y: number): boolean {
    return this.tiles.some((tile: SvgTile) => {
      return tile.x === x && tile.y === y;
    });
  }

  getTileFill(x: number, y: number): string {

    if(this.dragTiles.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
    {
      return '#272767';
    }

    if(this.tileGhosts.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
    {
      return '#27455d';
    }
    
    return '#34343400'
  }

  ghostTileExists(x: number, y: number): boolean {
    return this.tileGhosts.some((tile: SvgTile) => {
      return tile.x === x && tile.y === y;
    });
  }

  // coordToPos(x: number, y: number): string {
  //   console.log(`${x * 100}px ${y * 50}px`);
  //   return `${x * 100}px ${y * 50}px`;
  // }

  fetchTilesheet() {
    const tilesheetUrl = 'assets/tilesheets/walls_exterior_house_01.png';
    return this.http.get(tilesheetUrl, { responseType: 'blob' });
  }

  async splitTilesheet() {
    const tilesheetBlob: Blob | undefined = await this.fetchTilesheet().toPromise();
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

  saveTilesToCache() {
    this.splitTilesheet().then((tiles: string[]) => {
      tiles.forEach((tile: string, index: number) => {
        const tileName = `tile_${index}.png`;
  
        // Save the tile URL as a string to the browser cache (local storage)
        localStorage.setItem(tileName, tile);
      });
    });
  }

  getIndividualTile(name: string): SafeResourceUrl {
  
      const tileName = name;
      const tileUrl = localStorage.getItem(tileName);
      return tileUrl!;
      
  }

}

