import { Component, AfterViewInit, ViewChild, ElementRef, OnInit, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Furniture, FurnitureTile, FurnitureTileEntry, GridRoom, GridTile, SvgTile } from '../models/app.models';
import Tool from '../tools/tool';
import ToolTile from '../tools/tool-tile';
import ToolDraw from '../tools/tool-draw';
import ToolDrawRoom from '../tools/tool-draw-room';
import { Observable, Subject, takeUntil } from 'rxjs';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';
import { DbService, PngTile } from '../services/db.service';
import { TileService } from '../services/tile.service';
import { FurnitureService } from '../services/furniture.service';
import { GridService } from '../services/grid.service';
import { RoomService } from '../services/room.service';

@Component({
  selector: 'app-viewport',
  templateUrl: './viewport.component.html',
  styleUrls: ['./viewport.component.scss']
})
export class ViewportComponent implements OnInit{
  

  rowArray = Array(10).fill(0).map((x,i)=>i);
  colArray = Array(10).fill(0).map((x,i)=>i);

  tiles: SvgTile[] = [];
  //roomTiles: SvgTile[] = [];
  userTiles: SvgTile[] = [];
  //rooms: GridRoom[] = [];
  key: string = '';
  currentCoords: string = '0,0';
  //tileGhosts: SvgTile[] = [];
  //dragTiles: SvgTile[] = [];
  //beginDragCoords: number[] = [];
  //isDragging: boolean = false;


  fetchedTiles: PngTile[] = [];
  fetchingTiles: string[] = [];
  selectedTile: string = 'walls_interior_house_01_0.png';
  selectedLayer: string = 'Walls';

  //selectedTool: ToolDraw = new ToolTile(this);
  selectedTool: ToolDraw = new ToolDrawRoom(this, this.roomService, this.gridService);
  selectedTool$: Observable<string>;
  private unsubscribe: Subject<void> = new Subject();

  //constants
  layers: string[] = [
    'Floor', 
    'FloorOverlay', 
    'FloorGrime',
    'FloorGrime2',
    'FloorFurniture',
    'Vegetation',
    'Walls',
    'WallTrim',
    'Walls2',
    'WallTrim2',
    'RoofCap',
    'RoofCap2',
    'WallOverlay',
    'WallOverlay2',
    'WallGrime',
    'WallGrime2',
    'WallFurniture',
    'WallFurniture2',
    'Frames',
    'Doors',
    'Windows',
    'Curtains',
    'Furniture',
    'Furniture2',
    'Furniture3',
    'Furniture4',
    'Curtains2',
    'WallFurniture3',
    'WallFurniture4',
    'WallOverlay3',
    'WallOverlay4',
    'Roof',
    'Roof2',
    'RoofTop',
  ];

  constructor(
    private http: HttpClient, 
    private sanitizer: DomSanitizer, 
    private store: Store<fromRoot.State>,
    private db: DbService,
    private tileService: TileService,
    private furnitureService: FurnitureService,
    private gridService: GridService,
    private roomService: RoomService) 
  { 
    this.selectedTool$ = store.select(fromRoot.getCurrentTool);
    console.log(this.selectedTool$)
  }


  ngOnInit() {
    //Get tilesheets

    const tilepacks: string[] = [];
    this.http.get('assets/tilepacks.json').subscribe((data: any) => {
      for(let i = 0; i < data.length; i++)
      {
        const tilepack = data[i].Url;
        tilepacks.push(tilepack);
      }

      tilepacks.forEach((tilepack: string) => {
        this.http.get(tilepack).subscribe((data2: any) => {

          for(let i = 0; i < data2.length; i++)
          {
            const tilesheet = data2[i].url;
            const tilesheetName = data2[i].name;
            //this.db.addTileset(tilesheetName, tilesheet);
            //this.saveTilesToCache(tilesheetName, tilesheet);
            this.tileService.saveTilesToCache(tilesheetName, tilesheet);
          }
        });
      });
    });

    



    //this.saveTilesToCache('walls_exterior_house_01', 'assets/tilesheets/walls_exterior_house_01.png');
    //this.saveTilesToCache('floors_interior_tilesandwood_01', 'assets/tilesheets/floors_interior_tilesandwood_01.png');
    //this.tileService.saveTilesToCache('walls_exterior_house_01', 'assets/tilesheets/walls_exterior_house_01.png');
    //this.tileService.saveTilesToCache('floors_interior_tilesandwood_01', 'assets/tilesheets/floors_interior_tilesandwood_01.png');

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
          this.selectedTool = new ToolDrawRoom(this, this.roomService, this.gridService);
          console.log('tool-draw-room');
          break;
        default:
          this.selectedTool = new ToolDrawRoom(this, this.roomService, this.gridService);
          console.log('tool-draw-room - default');
          break;
      }
    });
  }

  redrawTiles() {
    console.log('redrawTiles()');
    this.tiles = [];
    this.gridService.roomTiles.forEach((tile: SvgTile) => {
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
    this.roomService.rooms.forEach((room: GridRoom) => {
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
      this.db.getTileset('walls_exterior_house_01').then((tilesheet: any) => {
        console.log(tilesheet);
      });
  }

  placeTile2(tile: SvgTile, isRoom: boolean)
  {
      if(isRoom)
      {
        //check if roomTiles contains tile
        if(this.gridService.roomTiles.some((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer;}))
        {
          const roomTile = this.gridService.roomTiles.find((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer;});
          if(roomTile)
          {
            roomTile.name = tile.name;
            roomTile.url = this.getIndividualTile(tile.name!);
          }
        }
        else
        {
          this.gridService.roomTiles.push(tile);
        }
      }
      else
      {
        console.log('placeTile2', tile);

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

  displayOverlay(x: number, y: number): boolean {
    let foundMatch = false;
  
    this.furnitureService.furniture.forEach((furniture: Furniture) => {
      furniture.entries.forEach((entry: FurnitureTileEntry) => {
        entry.tiles.forEach((tile: FurnitureTile) => {
          if (tile.x === x && tile.y === y) {
            foundMatch = true;
          }
        });
      });
    });
  
    return foundMatch;
  }

  // coordToPos(x: number, y: number): string {
  //   console.log(`${x * 100}px ${y * 50}px`);
  //   return `${x * 100}px ${y * 50}px`;
  // }

  //Tilesheet functions

  getIndividualTile(name: string, origin = 'undefined'): SafeResourceUrl {
  
     // const tileName = name;
     // const tileUrl = localStorage.getItem(tileName);
     // return tileUrl!;

    if(!name)
    {
      return '';
    }
    
     const existingTile = this.fetchedTiles.find((tile: PngTile) => {return tile.name === name;});
      if(existingTile)
      {
        this.fetchingTiles = this.fetchingTiles.filter((tile: string) => {return tile !== name;});
        return existingTile.url!;
      }

      if(this.fetchingTiles.includes(name))
    {
      return '';
    }
     
    this.fetchingTiles.push(name);

      this.db.getTile(name).then((tile: PngTile | null) => {
        if(tile)
        {
          if(!this.fetchedTiles.find((tile: PngTile) => {return tile.name === name;}))
          {

            this.fetchedTiles.push(tile);
            return tile.url!;
          }
        }

        return '';
      });

      return '';

     /*this.db.getTile(name).then((tile: SvgTile) => {
      if(tile)
      {
        this.userTiles.push({
          name: tile.name,
          url: tile.url,
          x: 0,
          y: 0,
          layer: this.selectedLayer,
        });
        return tile.url!;
      }
    });
      else
      {
        return '';
      }      */
    }

}

