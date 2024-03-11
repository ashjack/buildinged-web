import { HttpClient } from "@angular/common/http";
import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild } from "@angular/core";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { Store } from "@ngrx/store";
import { Observable, Subject, takeUntil } from "rxjs";
import { PngTile, DbService } from "../services/db.service";
import { FurnitureService } from "../services/furniture.service";
import { GridService } from "../services/grid.service";
import { RoomService } from "../services/room.service";
import { TileService } from "../services/tile.service";
import * as fromRoot from '../app.reducers';
import ToolDraw from "../tools/tool-draw";
import ToolDrawRoom from "../tools/tool-draw-room";
import ToolTile from "../tools/tool-tile";
import { GridTile, SvgTile } from "../models/app.models";
import { CacheService } from "../services/cache.service";
import { BuildingService } from "../services/building.service";

@Component({
    selector: 'app-viewport-canvas',
    templateUrl: './viewport-canvas.component.html',
    styleUrls: ['./viewport-canvas.component.scss']
})
export class ViewportCanvasComponent implements OnInit, AfterViewInit{
    rowArray = Array(20).fill(0).map((x,i)=>i);
    colArray = Array(20).fill(0).map((x,i)=>i);

    fetchedTiles: PngTile[] = [];
  fetchingTiles: string[] = [];
  selectedTile: string = 'walls_interior_house_01_0.png';
  selectedLayer: string = 'Walls';
  key: string = '';

  @ViewChild('canvasElement') canvasElement: ElementRef;
  private ctx: CanvasRenderingContext2D | null;

  //selectedTool: ToolDraw = new ToolTile(this);
  selectedTool: ToolDraw = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
  selectedTool$: Observable<string>;
  private unsubscribe: Subject<void> = new Subject();

  currentHoverCoords: Point = {x: 0, y: 0};

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

  newPositions: Position[] = [];

  screenWidth: number = 0;
  screenHeight: number = 0;

  xOffset: number = 0;
  yOffset: number = 0;
  zoom: number = 1;

  constructor(
    private http: HttpClient, 
    private sanitizer: DomSanitizer, 
    private store: Store<fromRoot.State>,
    private db: DbService,
    private tileService: TileService,
    private furnitureService: FurnitureService,
    private buildingService: BuildingService,
    private gridService: GridService,
    private roomService: RoomService,
    private cacheService: CacheService) 
  { 
    this.selectedTool$ = store.select(fromRoot.getCurrentTool);

    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;

    this.xOffset = (this.screenWidth / 1.5);
    this.yOffset = (this.screenHeight / 2);
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
            this.tileService.saveTilesToCache(tilesheetName, tilesheet);
          }
        });
      });
    });

    this.selectedTool$.pipe(
      takeUntil(this.unsubscribe)
    ).subscribe((x) => {
      switch(x)
      {
        case 'tool-tile':
          this.selectedTool = new ToolTile(this.gridService);
          break;
        case 'tool-draw-room':
          this.selectedTool = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
          break;
        default:
          this.selectedTool = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
          break;
      }
    });

  }

  ngAfterViewInit() {
    const canvas: HTMLCanvasElement = this.canvasElement.nativeElement;
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener("mousemove", (event) => this.getMousePos(event));

    if(this.ctx)
    {
      this.ctx.imageSmoothingEnabled = false;
    }

    this.drawCanvas();
  }

  hoverTile(x: number, y: number) {
    this.gridService.showAllTiles();
    this.gridService.redrawTiles();
    if(this.currentHoverCoords.x == x && this.currentHoverCoords.y == y)
    {
      return;
    }

    const hoverRoom = this.roomService.getRoomFromTile(x, y, this.gridService.getSelectedLevel());
    if(hoverRoom)
    {
      
      this.gridService.tiles.forEach((tile: SvgTile) => {
        if(!hoverRoom.tiles.some((t: GridTile) => t.x == tile.x && t.y == tile.y) && tile.layer !== 'Floor')
        {
          this.gridService.hideTile(tile.x, tile.y, tile.layer);
        }
        else
        {
          if(this.gridService.tileHidden(tile.x, tile.y, tile.layer))
          {
            this.gridService.showTile(tile.x, tile.y, tile.layer);
          }
        }
      });

      // this.gridService.roomTiles.forEach((tile: SvgTile) => {
      //   if(!hoverRoom.placedInteriorTiles.some((t: SvgTile) => t.x == tile.x && t.y == tile.y && t.name == tile.name))
      //   {
      //     if(tile.layer !== 'Floor')
      //     {
      //       this.gridService.hideTile(tile.x, tile.y, tile.layer);
      //     }
      //   }
      //   else
      //   {
      //     this.gridService.showTile(tile.x, tile.y, tile.layer);
      //   }
      // });

      this.gridService.redrawTiles();

    }
    else
    {
      console.log('no room');
      this.gridService.roomTiles.forEach((tile: SvgTile) => {
        this.gridService.showTile(tile.x, tile.y, tile.layer);
      });

      this.gridService.userTiles.forEach((tile: SvgTile) => {
        this.gridService.showTile(tile.x, tile.y, tile.layer);
      });
      this.gridService.redrawTiles();

    }

    this.selectedTool.hoverTile(x, y);

    this.drawCanvas(); //TODO call this from any redraw functions in the services...somehow
    //this.drawOverlaySquare(x, y, 'black', 'red');
    this.currentHoverCoords = {x: x, y: y};


    
    
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
    this.gridService.redrawTiles();
    this.drawCanvas();
  }

  //Drawing functions

  drawCanvas() {
    if (!this.ctx) {
      throw new Error('Canvas context is not defined');
    }



    //Clear canvas
    this.ctx.clearRect(0, 0, 5000, 5000);
    this.newPositions = [];

    //Tiles
    this.drawTiles();

    //Tool Overlay
    this.drawOverlay();

    //Grid
    this.drawIsometricGrid(20, 20);

    //const tile = this.getIndividualTile('walls_exterior_house_01_004.png') as string;
    //this.drawTile(6, 10, tile);
    //this.drawTile(6, 11, tile);

  }

  drawTiles() {

    if(this.selectedTool instanceof ToolTile)
    {
      this.selectedTool.tileGhosts.forEach((tile: SvgTile) => {
        this.gridService.tiles = this.gridService.tiles.filter((t: SvgTile) => t.x != tile.x || t.y != tile.y || t.layer != tile.layer);
        this.gridService.tiles.push(tile);
      });
    }

    this.gridService.sortTiles();

    this.gridService.tiles.forEach((tile: SvgTile) => {
      if(!tile.hidden)
      {
        const tileImage = this.getIndividualTile(tile.name!);
        this.drawTile(tile.x + (tile.offsetX ?? 0), tile.y + (tile.offsetY ?? 0), tile.name!, tileImage as string);
      }
    });

    
  }

  drawTile(x: number, y: number, tileName: string, tile: string) {
    if(!this.ctx) {
      throw new Error('Canvas context is not defined')
    };

    if(!tile || tile == null || tile == undefined || tile == 'AWAITING')
    {
      return;
    }

    const ctx = this.ctx;
    const canvasX = 2500 + x * 100 - y * 100;
    const canvasY = 100 + x * 50 + y * 50;

    const size = 204;


    x = (canvasX - this.xOffset - size / 2) * this.zoom;
    y = (canvasY - this.yOffset - size * 2) * this.zoom;

    const tileImage = this.cacheService.get(tileName);
    if(!tileImage || tileImage == null || tileImage == undefined)
    {
      const newTileImage = new Image();
      newTileImage.src = tile;
      newTileImage.onload = () => {
        this.cacheService.set(tileName, newTileImage);
        ctx.drawImage(newTileImage,x, y, size * this.zoom, size * 2 * this.zoom);
      }
    }
    else
    {
      this.ctx.drawImage(tileImage,x, y, size * this.zoom, size * 2 * this.zoom);
    }
  }

  drawOverlay() {
    if(this.selectedTool instanceof ToolDraw)
    {
      this.selectedTool.dragTiles.forEach((tile: SvgTile) => {
        this.drawOverlaySquare(tile.x, tile.y, 'black', this.selectedTool.getTileFill(tile.x, tile.y));
      });
    }
  }

  drawIsometricGrid(length: number, width: number) {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < length; y++) {
        const square = this.drawIsometricSquare(x, y);
        this.newPositions.push(
          {
            point: square,
            localPoint: {x: x, y: y}
          }
        )
      }
    }
  }

  drawOverlaySquare(x: number, y: number, lineColor: string, fillColor: string) {

    if(!this.ctx) {
      throw new Error('Canvas context is not defined')
    };

    const canvasX = 2500 + x * 100 - y * 100;
    const canvasY = 100 + x * 50 + y * 50;

    x = (canvasX - this.xOffset) * this.zoom;
    y = (canvasY - this.yOffset) * this.zoom;

    const size = 100 * this.zoom;

    this.ctx.beginPath();
    this.ctx.setLineDash([]);
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + size, y - size / 2);
    this.ctx.lineTo(x, y - size);
    this.ctx.lineTo(x - size, y - size / 2);
    this.ctx.closePath();
    this.ctx.strokeStyle = lineColor; // Set the stroke color
    this.ctx.lineWidth = 4; // Set the line width
    this.ctx.stroke();

    this.ctx.fillStyle = fillColor; // Set the fill color
    this.ctx.fill(); // Fill the shape with the specified color

    const polygon: Point[] = [
      {x: x, y: y},
      {x: x + size, y: y - size / 2},
      {x: x, y: y - size},
      {x: x - size, y: y - size / 2},
    ];
    
    return polygon;
  }

  drawIsometricSquare(x: number, y: number): Point[] {

    if(!this.ctx) {
      throw new Error('Canvas context is not defined')
    };

    const canvasX = 2500 + x * 100 - y * 100;
    const canvasY = 100 + x * 50 + y * 50;

    x = (canvasX - this.xOffset) * this.zoom;
    y = (canvasY - this.yOffset) * this.zoom;

    const size = 100 * this.zoom; // Set the size of the square
  
    // Draw the isometric square
    this.ctx.beginPath();
    this.ctx.setLineDash([1, 5]);
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + size, y - size / 2);
    this.ctx.lineTo(x, y - size);
    this.ctx.lineTo(x - size, y - size / 2);
    this.ctx.closePath();
    this.ctx.strokeStyle = '#000000'; // Set the stroke color
    this.ctx.lineWidth = 1; // Set the line width
    this.ctx.stroke();

    const polygon: Point[] = [
      {x: x, y: y},
      {x: x + size, y: y - size / 2},
      {x: x, y: y - size},
      {x: x - size, y: y - size / 2},
    ];

    return polygon;
  }

  //Image functions
  getIndividualTile(name: string, origin = 'undefined'): SafeResourceUrl {
    return this.gridService.getIndividualTile(name, origin);
  }


  //Mouse functions

  dragStartPos: Point = {x: 0, y: 0};
  
  @HostListener('mousedown', ['$event']) onMouseDown(event: MouseEvent){
    if(event.which === 2)
    {
      event.preventDefault();
      this.dragStartPos = {x: event.clientX, y: event.clientY};
    }
    else if(event.button === 0)
    {
      event.preventDefault();
      this.beginDrag(event, this.currentHoverCoords.x, this.currentHoverCoords.y);
    }
  }

  @HostListener('mouseup', ['$event']) onMouseUp(event: MouseEvent){
    if(event.which === 2)
    {
      event.preventDefault();
    }
    else if(event.button === 0)
    {
      event.preventDefault();
      this.endDrag(event, this.currentHoverCoords.x, this.currentHoverCoords.y);
    }
  }

  @HostListener('wheel', ['$event']) onMouseWheel(event: WheelEvent){
    event.preventDefault();
    if(event.ctrlKey) {
      if(event.deltaY > 0) {
        this.zoom = this.zoom - 0.2;
        this.drawCanvas();
      } else {
        this.zoom = this.zoom + 0.2;
        this.drawCanvas();
      }
    }
  }

  getMousePos(event: MouseEvent) {
    if(!this.ctx) return;
    const canvas = this.ctx!.canvas;
    const rect = canvas?.getBoundingClientRect();
    const x: number = (Math.round(event.clientX - rect.left) / (rect.right - rect.left) * canvas.width);
    const y: number =  (Math.round(event.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height);
    const pos = this.getCoordsFromMousePos(x, y);
    this.newPositions.forEach((pos: Position) => {
      const pointToCheck: Point = { x: x, y: y };
      const found = this.pointInPolygon(pointToCheck, pos.point);
      if(found) {
        const localX = pos.localPoint.x
        const localY = pos.localPoint.y
        this.hoverTile(localX, localY);
      }
    });

    if(event.which === 2)
    {
      event.preventDefault();
      this.xOffset -= (event.clientX - this.dragStartPos.x) / this.zoom;
      this.yOffset -= (event.clientY - this.dragStartPos.y) / this.zoom;
      this.dragStartPos = {x: event.clientX, y: event.clientY};
      this.drawCanvas();
    }
}

  getCoordsFromMousePos(x: number, y: number) {
    const i = Math.floor((x - 2500) / 100 + (y - 100) / 50);
    const j = Math.floor((y - 100) / 50 - (x - 2500) / 100);
    return { i, j };
  }

  
  
  pointInPolygon(point: Point, polygon: Point[]): boolean {
    const n = polygon.length;
    // Check if the point is within the bounding box
    const minX = Math.min(...polygon.map(p => p.x));
    const maxX = Math.max(...polygon.map(p => p.x));
    const minY = Math.min(...polygon.map(p => p.y));
    const maxY = Math.max(...polygon.map(p => p.y));
  
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
      return false;
    }
  
    // Perform ray-casting algorithm
    let oddNodes = false;
    let j = n - 1;
  
    for (let i = 0; i < n; i++) {
      if (
        (polygon[i].y < point.y && polygon[j].y >= point.y) ||
        (polygon[j].y < point.y && polygon[i].y >= point.y)
      ) {
        if (
          polygon[i].x +
            ((point.y - polygon[i].y) / (polygon[j].y - polygon[i].y)) *
              (polygon[j].x - polygon[i].x) <
          point.x
        ) {
          oddNodes = !oddNodes;
        }
      }
      j = i;
    }
  
    return oddNodes;
  }

  //Keyboard functions
  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) { 
    this.key = event.key;
    this.selectedTool.key = event.key;
    this.drawCanvas();
  }

  @HostListener('document:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) { 
    this.key = '';
    this.selectedTool.key = '';
    this.drawCanvas();
  }

  
}

interface Point {
  x: number;
  y: number;
}

interface Position {
  point: Point[];
  localPoint: Point;

}