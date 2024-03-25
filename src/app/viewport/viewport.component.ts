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
import { BuildingService } from '../services/building.service';

@Component({
  selector: 'app-viewport',
  templateUrl: './viewport.component.html',
  styleUrls: ['./viewport.component.scss']
})
export class ViewportComponent implements OnInit{
  

  rowArray = Array(20).fill(0).map((x,i)=>i);
  colArray = Array(20).fill(0).map((x,i)=>i);

  //rowArray = this.gridService.rowArray;
  //colArray = this.gridService.colArray;

  //tiles: SvgTile[] = [];
  //roomTiles: SvgTile[] = [];
  //userTiles: SvgTile[] = [];
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
  selectedTool: ToolDraw = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
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
    private buildingService: BuildingService,
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
            //this.tileService.saveTilesToCache(tilesheetName, tilesheet);
          }
        });
      });
    });

    this.selectedTool$.pipe(
      takeUntil(this.unsubscribe)
    ).subscribe((x) => {
      console.log(`selectedTool$ = ${x}`);
      switch(x)
      {
        case 'tool-tile':
          this.selectedTool = new ToolTile(this.gridService);
          console.log('tool-tile');
          break;
        case 'tool-draw-room':
          this.selectedTool = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
          console.log('tool-draw-room');
          break;
        default:
          this.selectedTool = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
          console.log('tool-draw-room - default');
          break;
      }
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
        this.gridService.tiles.forEach((tile: SvgTile) => {
          if(!room.placedInteriorTiles.some((placedTile: SvgTile) => {return placedTile.x === tile.x && placedTile.y === tile.y;}))
          {
            tile.hidden = true;
          }
        });
      }
    });

    if(!foundRoom)
    {
      this.gridService.tiles.forEach((tile: SvgTile) => {
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

  removeTile(x: number, y: number, layer: string) {
    this.gridService.tiles = this.gridService.tiles.filter((tile: SvgTile) => {
      return tile.x !== x || tile.y !== y && tile.layer !== layer;
    });
  }

  getTileAt(x: number, y: number, layer: string): SvgTile | undefined {
    return this.gridService.tiles.find((tile: SvgTile) => {
      return tile.x === x && tile.y === y && tile.layer === layer;
    });
  }

  tileExists(x: number, y: number, layer: string): boolean {
    //console.log(this.tiles)
    return this.gridService.tiles.some((tile: SvgTile) => {
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
  

    return this.gridService.getIndividualTile(name, origin);
     // const tileName = name;
     // const tileUrl = localStorage.getItem(tileName);
     // return tileUrl!;

    /*if(!name)
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

      return '';*/
    }

}

