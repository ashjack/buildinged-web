import { Component, AfterViewInit, ViewChild, ElementRef, OnInit, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { GridRoom, GridTile, SvgTile } from '../models/app.models';
import Tool from '../tools/tool';
import ToolTile from '../tools/tool-tile';
import ToolDraw from '../tools/tool-draw';
import ToolDrawRoom from '../tools/tool-draw-room';
import { Observable, Subject, takeUntil } from 'rxjs';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';

@Component({
  selector: 'app-viewport',
  templateUrl: './viewport.component.html',
  styleUrls: ['./viewport.component.scss']
})
export class ViewportComponent implements OnInit{


  rowArray = Array(10).fill(0).map((x,i)=>i);
  colArray = Array(10).fill(0).map((x,i)=>i);

  tiles: SvgTile[] = [];
  roomTiles: SvgTile[] = [];
  userTiles: SvgTile[] = [];
  rooms: GridRoom[] = [];
  key: string = '';
  currentCoords: string = '0,0';
  //tileGhosts: SvgTile[] = [];
  //dragTiles: SvgTile[] = [];
  //beginDragCoords: number[] = [];
  //isDragging: boolean = false;

  selectedTile: string = 'tile_0.png';
  selectedLayer: string = 'Walls';

  //selectedTool: ToolDraw = new ToolTile(this);
  selectedTool: ToolDraw = new ToolDrawRoom(this);
  selectedTool$: Observable<string>;
  private unsubscribe: Subject<void> = new Subject();

  constructor(private http: HttpClient, private sanitizer: DomSanitizer, private store: Store<fromRoot.State>) { 
    this.selectedTool$ = store.select(fromRoot.getCurrentTool);
    console.log(this.selectedTool$)
  }


  ngOnInit() {
    this.saveTilesToCache();
    this.selectedTool$.pipe(
      takeUntil(this.unsubscribe)
    ).subscribe((x) => {
      console.log(`selectedTool$ = ${x}`);
      switch(x)
      {
        case 'tool-tile':
          this.selectedTool = new ToolTile(this);
          console.log('tool-tile');
          break;
        case 'tool-draw-room':
          this.selectedTool = new ToolDrawRoom(this);
          console.log('tool-draw-room');
          break;
        default:
          this.selectedTool = new ToolDrawRoom(this);
          console.log('tool-draw-room - default');
          break;
      }
    });
  }

  redrawTiles() {
    this.tiles = [];
    this.roomTiles.forEach((tile: SvgTile) => {
      this.placeTile_old(tile.x, tile.y, tile.name, tile.layer);
    });

    this.userTiles.forEach((tile: SvgTile) => {
      this.placeTile_old(tile.x, tile.y, tile.name, tile.layer);
    });
  }

  hoverTile(x: number, y: number) {
    this.selectedTile = localStorage.getItem('selectedTile')!;
    this.selectedLayer = localStorage.getItem('selectedLayer')!;
    this.selectedTool.hoverTile(x, y);
    this.currentCoords = `${x},${y}`;

    //check if tile is in any rooms
    let foundRoom: boolean = false;
    this.rooms.forEach((room: GridRoom) => {
      if(room.tiles.some((tile: GridTile) => {return tile.x === x && tile.y === y;}))
      {
        foundRoom = true;

        //hide all tiles not in room.interiorTiles
        this.tiles.forEach((tile: SvgTile) => {
          if(!room.placedInteriorTiles.some((placedTile: SvgTile) => {return placedTile.x === tile.x && placedTile.y === tile.y;}))
          {
            tile.hidden = true;
          }
        });
      }
    });

    if(!foundRoom)
    {
      this.tiles.forEach((tile: SvgTile) => {
        tile.hidden = false;
      });
    }
  }

  beginDrag($event: MouseEvent, x: number, y: number)
  {
    if($event.button != 0)
    {
      return;
    }

    this.selectedTool.beginDrag(x, y);
  }

  endDrag($event: MouseEvent, x: number, y: number)
  {
    if($event.button != 0)
    {
      return;
    }

    this.selectedTool.endDrag(x, y);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) { 
    this.key = event.key;
    this.selectedTool.key = event.key;
  }

  @HostListener('document:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) { 
    this.key = '';
    this.selectedTool.key = '';
  }

  clickTile($event: MouseEvent, x: number, y: number) {
      
      if($event.button != 0)
      {
        return;
      }
  
      this.selectedTool.clickTile(x, y);
  }

  placeTile2(tile: SvgTile, isRoom: boolean)
  {
      console.log(`placeTile2(${tile.x}, ${tile.y}, ${tile.name}, ${tile.layer})`);

      if(isRoom)
      {
        //check if roomTiles contains tile
        if(this.roomTiles.some((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y;}))
        {
          const roomTile = this.roomTiles.find((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y;});
          if(roomTile)
          {
            roomTile.name = tile.name;
            roomTile.url = this.getIndividualTile(tile.name!);
          }
        }
        else
        {
          this.roomTiles.push(tile);
        }
      }
      else
      {
        //check if userTiles contains tile
        if(this.userTiles.some((userTile: SvgTile) => {return userTile.x === tile.x && userTile.y === tile.y && userTile.layer == tile.layer;}))
        {
          const userTile = this.userTiles.find((userTile: SvgTile) => {return userTile.x === tile.x && userTile.y === tile.y && userTile.layer === tile.layer;});
          if(userTile)
          {
            userTile.name = tile.name;
            userTile.url = this.getIndividualTile(tile.name!);
          }
        }
        else
        {
          this.userTiles.push(tile);
        }
      }


      this.redrawTiles();
  }

  placeTile_old(x: number, y: number, name: string = '', layer: string = 'Walls') {

    console.log(this.tiles);

    if(name === '')
    {
      name = this.selectedTile;
    }

    if(this.tileExists(x, y, layer))
    {
      //edit tile name and url
      const tile = this.getTileAt(x, y, layer);
      if(tile)
      {
        tile.name = name;
        tile.url = this.getIndividualTile(name);
        return;
      }
    }
    const tile: SvgTile = {
      name: name,
            url: this.getIndividualTile(name),
      x: x,
      y: y,
      layer: layer,
    };
    this.tiles.push(tile);
    //this.tileGhosts = [];
  }

  removeTile(x: number, y: number, layer: string) {
    this.tiles = this.tiles.filter((tile: SvgTile) => {
      return tile.x !== x || tile.y !== y && tile.layer !== layer;
    });
  }

  getTileAt(x: number, y: number, layer: string): SvgTile | undefined {
    return this.tiles.find((tile: SvgTile) => {
      return tile.x === x && tile.y === y && tile.layer === layer;
    });
  }

  tileExists(x: number, y: number, layer: string): boolean {
    //console.log(this.tiles)
    return this.tiles.some((tile: SvgTile) => {
      return tile.x === x && tile.y === y;
    });
  }

  tileHidden(x: number, y: number, layer: string): boolean {
    const tile = this.getTileAt(x, y, layer);
    if(tile)
    {
      return tile.hidden!;
    }
    return false;
  }

  getTileFill(x: number, y: number): string {

    const fill = this.selectedTool.getTileFill(x, y);
    return fill;
  }

  ghostTileExists(x: number, y: number, layer: string): boolean {
    if(this.selectedTool instanceof ToolTile)
    {
      return this.selectedTool.tileGhosts.some((tile: SvgTile) => {
        return tile.x === x && tile.y === y && tile.layer === layer;
      });
    }

    return false;
  }

  // coordToPos(x: number, y: number): string {
  //   console.log(`${x * 100}px ${y * 50}px`);
  //   return `${x * 100}px ${y * 50}px`;
  // }

  //Tilesheet functions

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

