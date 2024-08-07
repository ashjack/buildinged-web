import { HttpClient } from "@angular/common/http";
import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild } from "@angular/core";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { Store } from "@ngrx/store";
import { Observable, Subject, from, take, takeUntil } from "rxjs";
import { PngTile, DbService } from "../services/db.service";
import { FurnitureService } from "../services/furniture.service";
import { GridService } from "../services/grid.service";
import { RoomService } from "../services/room.service";
import { TileService } from "../services/tile.service";
import * as fromRoot from '../app.reducers';
import ToolDraw from "../tools/tool-draw";
import ToolDrawRoom from "../tools/tool-draw-room";
import ToolTile from "../tools/tool-tile";
import { GridTile, Point, SvgObject, SvgObjectOverlay, SvgTile, Tilepack } from "../models/app.models";
import { CacheService } from "../services/cache.service";
import { BuildingService } from "../services/building.service";
import { RemoveObject, ScheduleRedraw } from "../app.actions";
import ToolDoor from "../tools/tool-door";
import { DoorService } from "../services/door.service";
import ToolWindow from "../tools/tool-window";
import { WindowService } from "../services/window.service";
import ToolFurniture from "../tools/tool-furniture";
import ToolRoof from "../tools/tool-roof";
import { RoofService } from "../services/roof.service";

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
  //selectedTool: ToolDraw = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService);
  selectedTool: ToolDraw = new ToolDoor(this.doorService, this.gridService)
  selectedTool$: Observable<string>;
  scheduleRedraw: boolean;
  scheduleRedraw$: Observable<boolean>;

  private unsubscribe: Subject<void> = new Subject();

  currentHoverCoords: Point = {x: 0, y: 0};
  currentHoverCoordSegments = {edge: '', corner: ''}
  currentHoverObject: SvgObject | undefined = undefined;

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
    private cacheService: CacheService,
    private doorService: DoorService,
    private windowService: WindowService,
    private roofService: RoofService) 
  { 
    this.selectedTool$ = store.select(fromRoot.getCurrentTool);
    this.scheduleRedraw$ = store.select(fromRoot.getRedrawSchedule);

    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;

    this.xOffset = (this.screenWidth / 1.5);
    this.yOffset = (this.screenHeight / 2);
  }

  ngOnInit() {
    //Get tilesheets

    
    this.http.get('assets/tilepacks.json').subscribe((data: any) => {
      for (let i = 0; i < data.length; i++) {
        const tilepack = data[i].Url;
        const packName = data[i].Name;
        this.tileService.tilepacks.push({ url: tilepack, name: packName, enabled: false });
        console.log(tilepack);
      }

      if(!localStorage.getItem('Vanilla'))
      {
        localStorage.setItem('Vanilla', '1');
      }
      this.tileService.processTilepacks(this.tileService.tilepacks, 0);
    });

    this.selectedTool$.pipe(
      takeUntil(this.unsubscribe)
    ).subscribe((x) => {
      switch(x)
      {
        case 'tool-tile':
          this.selectedTool = new ToolTile(this.gridService, this.store);
          break;
        case 'tool-draw-room':
          this.selectedTool = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService, this.store);
          break;
        case 'tool-door':
          this.selectedTool = new ToolDoor(this.doorService, this.gridService);
          break;return;
        case 'tool-window':
          this.selectedTool = new ToolWindow(this.windowService, this.gridService, this.buildingService);
          break;
        case 'tool-furniture':
          this.selectedTool = new ToolFurniture(this.gridService, this.store, this.furnitureService);
          break;
        case 'tool-roof':
          this.selectedTool = new ToolRoof(this.roofService, this.gridService);
          break;
        default:
          this.selectedTool = new ToolDrawRoom(this.roomService, this.gridService, this.buildingService, this.store);
          break;
      }
    });

    this.scheduleRedraw$.pipe(
      takeUntil(this.unsubscribe)
    ).subscribe((x) => {
      if(x)
      {
        this.drawCanvas();
        this.store.dispatch(new ScheduleRedraw(false));
      }
    })
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
    this.loadBuildingXmlFromLocalStorage();
  }

  loadBuildingXmlFromLocalStorage() {
    const xmlString = localStorage.getItem('buildingXml');
    if (xmlString) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
        this.buildingService.createBuildingFromXml(xmlDoc);
        return xmlDoc;
    } else {
        return null;
    }
}

  hoverTile(x: number, y: number, closestEdge?: string, closestCorner?: string) {
    if(closestEdge !== this.currentHoverCoordSegments.edge || closestCorner !== this.currentHoverCoordSegments.corner)
    {
      this.currentHoverCoordSegments = {edge: closestEdge ?? '', corner: closestCorner ?? ''}
    }

    else if(this.currentHoverCoords.x == x && this.currentHoverCoords.y == y)
    {
      return;
    }

    if(this.currentHoverCoords.x != x || this.currentHoverCoords.y != y)
    {
      this.gridService.showAllTiles();
      this.gridService.redrawTiles();
    }

    //Gets room within specific walls being hovered over
  //   const hoverRoomNew = this.roomService.getRoomFromTile(x, y, this.gridService.getSelectedLevel());
  //   if (hoverRoomNew) {
  //     const visitedTiles = new Set(); // Set to store visited tiles
  //     const wallTiles = new Set(); // Set to store wall tiles
  //     const enclosedTiles = new Set(); // Set to store enclosed tiles
  //     const gs = this.gridService;
  
  //     // Function to perform flood fill from a starting tile
  //     function floodFill(x: number, y: number) {
  //         if (visitedTiles.has(`${x},${y}`) || (!gs.tileExists(x, y, gs.getSelectedLevel(), 'Walls') && !gs.tileExists(x, y, gs.getSelectedLevel(), 'Walls2'))) {
  //             return;
  //         }
  
  //         visitedTiles.add(`${x},${y}`);
  //         enclosedTiles.add(`${x},${y}`);
  
  //         // Recursively visit neighboring tiles
  //         floodFill(x - 1, y);
  //         floodFill(x + 1, y);
  //         floodFill(x, y - 1);
  //         floodFill(x, y + 1);
  //     }
  
  //     // Start flood fill from any tile within the room
  //     hoverRoomNew.tiles.forEach((tile: GridTile) => {
  //         const { x, y } = tile;
  //         wallTiles.add(`${x},${y}`); // Add wall tiles to the set
  //     });
  
  //     // Choose any tile within the room as a starting point for flood fill
  //     const startTile = hoverRoomNew.tiles[0];
  //     floodFill(startTile.x, startTile.y);
  
  //     // Highlight enclosed tiles
  //     this.gridService.tiles.forEach((tile: SvgTile) => {
  //         if (enclosedTiles.has(`${tile.x},${tile.y}`)) {
  //             this.gridService.showTile(tile.x, tile.y, tile.layer);
  //         } else {
  //             this.gridService.hideTile(tile.x, tile.y, tile.layer);
  //         }
  //     });
  // }
  

    //Gets room currently being hovered over - TODO disable this
    const hoverRoom = this.roomService.getRoomFromTile(x, y, this.gridService.getSelectedLevel());
    if(hoverRoom)
    {
      this.gridService.tiles.forEach((tile: SvgTile) => {
        if(!hoverRoom.tiles.some((t: GridTile) => t.x == tile.x && t.y == tile.y && t.level == tile.level) && tile.layer !== 'Floor' && tile.level == this.gridService.getSelectedLevel())
        {
          this.gridService.hideTile(tile.x, tile.y, tile.level, tile.layer);
        }
        else
        {
          if(this.gridService.tileHidden(tile.x, tile.y, tile.level, tile.layer))
          {
            this.gridService.showTile(tile.x, tile.y, tile.level, tile.layer);
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
      this.gridService.roomTiles.forEach((tile: SvgTile) => {
        this.gridService.showTile(tile.x, tile.y, tile.level, tile.layer);
      });

      this.gridService.userTiles.forEach((tile: SvgTile) => {
        this.gridService.showTile(tile.x, tile.y, tile.level, tile.layer);
      });
      this.gridService.redrawTiles();

    }

    this.selectedTool.hoverTile(x, y, closestEdge, closestCorner);

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

    //Object Overlay
    this.drawTileOverlays();

    //Tool Overlay
    this.drawOverlay();

    //Grid
    if(this.buildingService.building)
    {
      this.drawIsometricGrid(this.buildingService.building.height, this.buildingService.building.width);
    }
    else
    {
      this.drawIsometricGrid(20, 20);
    }

    //const tile = this.getIndividualTile('walls_exterior_house_01_004.png') as string;
    //this.drawTile(6, 10, tile);
    //this.drawTile(6, 11, tile);

  }

  drawTiles() {

    if (this.selectedTool instanceof ToolTile || this.selectedTool instanceof ToolDoor || this.selectedTool instanceof ToolWindow || this.selectedTool instanceof ToolFurniture || this.selectedTool instanceof ToolRoof) {
      this.selectedTool.tileGhosts.forEach((tile: SvgTile) => {
          // Filter out tiles with the same position and layer on the same level as the hovering tile
          this.gridService.tiles = this.gridService.tiles.filter((t: SvgTile) => {
              return !(t.x === tile.x && t.y === tile.y && t.layer === tile.layer && t.level === tile.level);
          });
          // Add the hovering tile to the tiles array
          this.gridService.tiles.push(tile);
      });
  }

    this.gridService.sortTiles();

    //console.log(this.gridService.tiles)

    let drawnDarkOverlay = false;

    this.gridService.tiles.forEach((tile: SvgTile) => {
      const underObject = this.gridService.getObjectFromTile(tile.x, tile.y, tile.level - 1, "Furniture");
      if(underObject && underObject.type == 'Stairs')
      {
        if(tile.layer == 'Floor')
        {
          tile.excluded = true;
        }
      }
      if(!tile.hidden && !tile.excluded)
      {
        if(!drawnDarkOverlay && this.gridService.getSelectedLevel() == tile.level && this.ctx)
        {
          const canvas: HTMLCanvasElement = this.canvasElement.nativeElement
          drawnDarkOverlay = true;
          this.ctx.fillStyle = 'rgba(52, 52, 52, 0.5)';
          this.ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

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

  drawTileOverlays() {
    this.gridService.objectOverlays = [];
    this.gridService.objects.forEach((obj: SvgObject) => {   
      if(obj.level === this.gridService.getSelectedLevel())
      {   
        this.drawOverlayBlock(obj.x, obj.y, obj.length ?? 0, obj.width ?? 0, '#1d1aeb60', '#ffffff30', obj.orient, obj.type, obj);
      }
    });
  }

  drawOverlay() {
    if(this.selectedTool instanceof ToolDraw && !(this.selectedTool instanceof ToolDoor) && !(this.selectedTool instanceof ToolWindow))
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

  drawOverlayBlock(x: number, y: number, length: number, width: number, lineColor: string, fillColor: string, orient?: string, type?: string, obj?: SvgObject) {
    if(!this.ctx) {
      throw new Error('Canvas context is not defined')
    };

    x = x + length;
    y = y + width;

    if(orient == 'W' && (type == 'Wall' || type == 'Door' || type == 'Window'))
    {
      x--;
    }

    if(this.currentHoverObject == obj)
    {
      console.log(fillColor + " " + lineColor)
    }

    const canvasX = 2500 + x * 100 - y * 100;
    const canvasY = 100 + x * 50 + y * 50;

    x = (canvasX - this.xOffset) * this.zoom;
    y = (canvasY - this.yOffset) * this.zoom;

    const size = 100 * this.zoom;
    const xsize = 100 * this.zoom * width;
    const ysize = 100 * this.zoom * length;
    let xpadding = 20 * this.zoom;
    let ypadding = 10 * this.zoom;

    if(type == 'WallFurniture')
    {
      const bottomX = x;
      const bottomY = y - ypadding;
      const rightX = x + size + xsize - xpadding;
      const rightY = y - (xsize / 2) - size / 2;
      const topX = x - ysize + xsize;
      const topY = y - (ysize / 2) - (xsize / 2) - size + ypadding;
      const leftX = x - size - ysize + xpadding;
      const leftY = y - (ysize / 2) - size / 2;

      if(orient?.includes('N'))
      {
        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(topX, topY);
        this.ctx.lineTo(rightX, rightY);
        this.ctx.lineTo(rightX - 20 * this.zoom, rightY + 10 * this.zoom);
        this.ctx.lineTo(topX - 20 * this.zoom, topY + 10 * this.zoom);
        this.ctx.closePath();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();

        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        const objOverlay: SvgObjectOverlay = {
          points: [{x: topX, y: topY}, {x: rightX, y: rightY}, {x: rightX - 20 * this.zoom, y: rightY + 10 * this.zoom}, {x: topX - 20 * this.zoom, y: topY + 10 * this.zoom}],
          object: obj
        }
        if(obj) { this.gridService.objectOverlays.push(objOverlay); }
      }
      if(orient?.includes('W'))
      {
        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(topX, topY); //top
        this.ctx.lineTo(leftX, leftY); //left
        this.ctx.lineTo(leftX + 20 * this.zoom, leftY + 10 * this.zoom); //bottom
        this.ctx.lineTo(topX + 20 * this.zoom, topY + 10 * this.zoom); //right
        this.ctx.closePath();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        const objOverlay: SvgObjectOverlay = {
          points: [{x: topX, y: topY}, {x: leftX, y: leftY}, {x: leftX + 20 * this.zoom, y: leftY + 10 * this.zoom}, {x: topX + 20 * this.zoom, y: topY + 10 * this.zoom}],
          object: obj
        }
        if(obj) { this.gridService.objectOverlays.push(objOverlay); }
      }
      if(orient?.includes('S'))
      {
        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(bottomX, bottomY); //bottom corner
        this.ctx.lineTo(leftX, leftY); //left corner
        this.ctx.lineTo(leftX + 20 * this.zoom, leftY - 10 * this.zoom); //top corner
        this.ctx.lineTo(bottomX + 20 * this.zoom, bottomY - 10 * this.zoom); //right corner
        this.ctx.closePath();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        const objOverlay: SvgObjectOverlay = {
          points: [{x: bottomX, y: bottomY}, {x: leftX, y: leftY}, {x: leftX + 20 * this.zoom, y: leftY - 10 * this.zoom}, {x: bottomX + 20 * this.zoom, y: bottomY - 10 * this.zoom}],
          object: obj
        }
        if(obj) { this.gridService.objectOverlays.push(objOverlay); }
      }
      if(orient?.includes('E'))
      {
        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(bottomX, bottomY);
        this.ctx.lineTo(rightX, rightY);
        this.ctx.lineTo(rightX - 20 * this.zoom, rightY - 10 * this.zoom);
        this.ctx.lineTo(bottomX - 20 * this.zoom, bottomY - 10 * this.zoom);
        this.ctx.closePath();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        const objOverlay: SvgObjectOverlay = {
          points: [{x: bottomX, y: bottomY}, {x: rightX, y: rightY}, {x: rightX - 20 * this.zoom, y: rightY - 10 * this.zoom}, {x: bottomX - 20 * this.zoom, y: bottomY - 10 * this.zoom}],
          object: obj
        }
        if(obj) { this.gridService.objectOverlays.push(objOverlay); }
      }
    }
    else if(type == 'Wall' || type == 'Door' || type == 'Window')
    {

      const bottomX = x;
      const bottomY = y - ypadding;
      const rightX = x + size + xsize - xpadding;
      const rightY = y - (xsize / 2) - size / 2;
      const topX = x - ysize + xsize;
      const topY = y - (ysize / 2) - (xsize / 2) - size + ypadding;
      const leftX = x - size - ysize + xpadding;
      const leftY = y - (ysize / 2) - size / 2

      if(orient?.includes('N'))
      {
        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(topX, topY);
        this.ctx.lineTo(rightX, rightY);
        this.ctx.lineTo(rightX + 20 * this.zoom, rightY - 10 * this.zoom);
        this.ctx.lineTo(topX + 20 * this.zoom, topY - 10 * this.zoom);
        this.ctx.closePath();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();

        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        const objOverlay: SvgObjectOverlay = {
          points: [
              {x: topX, y: topY},
              {x: rightX, y: rightY},
              {x: rightX + 20 * this.zoom, y: rightY - 10 * this.zoom},
              {x: topX + 20 * this.zoom, y: topY - 10 * this.zoom}
          ],
          object: obj
      };
      
      if(obj) { this.gridService.objectOverlays.push(objOverlay); }
      
      }
      if(orient?.includes('W'))
      {
        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(bottomX, bottomY);
        this.ctx.lineTo(rightX, rightY);
        this.ctx.lineTo(rightX + 20 * this.zoom, rightY + 10 * this.zoom);
        this.ctx.lineTo(bottomX + 20 * this.zoom, bottomY + 10 * this.zoom);
        this.ctx.closePath();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        const objOverlay: SvgObjectOverlay = {
          points: [
              {x: bottomX, y: bottomY},
              {x: rightX, y: rightY},
              {x: rightX + 20 * this.zoom, y: rightY + 10 * this.zoom},
              {x: bottomX + 20 * this.zoom, y: bottomY + 10 * this.zoom}
          ],
          object: obj
      };
      
      if(obj) { this.gridService.objectOverlays.push(objOverlay); }
      
      }

      return;
    }
    else if(type == 'Stairs')
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(x, y); //Bottom Corner
      this.ctx.lineTo(x + size + xsize, y - (xsize / 2) - size / 2); //Right Corner
      this.ctx.lineTo(x - ysize + xsize, y - (ysize / 2) - (xsize / 2) - size); //Top Corner
      this.ctx.lineTo(x - size - ysize, y - (ysize / 2) - size / 2); //Left Corner
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor; // Set the stroke color
      this.ctx.lineWidth = 2 * this.zoom;
      this.ctx.stroke();

      this.ctx.fillStyle = fillColor; // Set the fill color
      this.ctx.fill(); // Fill the shape with the specified color

      const objOverlay: SvgObjectOverlay = {
        points: [
            {x: x, y: y}, // Bottom Corner
            {x: x + size + xsize, y: y - (xsize / 2) - size / 2}, // Right Corner
            {x: x - ysize + xsize, y: y - (ysize / 2) - (xsize / 2) - size}, // Top Corner
            {x: x - size - ysize, y: y - (ysize / 2) - size / 2} // Left Corner
        ],
        object: obj
    };
    
    if(obj) { this.gridService.objectOverlays.push(objOverlay); }

    return;
    }
    else if(type == 'Roof' || type == 'roof')
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(x, y); //Bottom Corner
      this.ctx.lineTo(x + size + xsize, y - (xsize / 2) - size / 2); //Right Corner
      this.ctx.lineTo(x - ysize + xsize, y - (ysize / 2) - (xsize / 2) - size); //Top Corner
      this.ctx.lineTo(x - size - ysize, y - (ysize / 2) - size / 2); //Left Corner
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor; // Set the stroke color
      this.ctx.lineWidth = 1 * this.zoom;
      this.ctx.stroke();

      this.ctx.fillStyle = fillColor; // Set the fill color
      this.ctx.fill(); // Fill the shape with the specified color

      const objOverlay: SvgObjectOverlay = {
        points: [
            {x: x, y: y}, // Bottom Corner
            {x: x + size + xsize, y: y - (xsize / 2) - size / 2}, // Right Corner
            {x: x - ysize + xsize, y: y - (ysize / 2) - (xsize / 2) - size}, // Top Corner
            {x: x - size - ysize, y: y - (ysize / 2) - size / 2} // Left Corner
        ],
        object: obj
      };
    
      if(obj) { this.gridService.objectOverlays.push(objOverlay); }

      //Toggle Cap Buttons
      const bottomX = x;
      const bottomY = y - (10 * this.zoom);
      const rightX = x + size + xsize - (1 * this.zoom);
      const rightY = y - (xsize / 2) - size / 2;
      const topX = x - ysize + xsize;
      const topY = y - (ysize / 2) - (xsize / 2) - size + (1 * this.zoom);
      const leftX = x - size - ysize + (20 * this.zoom);
      const leftY = y - (ysize / 2) - size / 2;

      if(orient?.includes('W'))
      {
        const middleX = 50 * this.zoom;
        const middleY = 25 * this.zoom;

        this.ctx.beginPath();
        this.ctx.setLineDash([]);
        this.ctx.moveTo(x + middleX, y - middleY); //Bottom Corner
        this.ctx.lineTo(x - middleX + size + xsize, y + middleY - (xsize / 2) - size / 2); //Right Corner
        this.ctx.lineTo(x - middleX + size + xsize - middleX, y - (xsize / 2) - size / 2); //Top Corner
        this.ctx.lineTo(x, y - middleX); //Left Corner
        this.ctx.closePath();
        this.ctx.strokeStyle = "#000000"; // Set the stroke color
        this.ctx.lineWidth = 2 * this.zoom;
        this.ctx.stroke();

        this.ctx.fillStyle = '#97979760'; // Set the fill color 
        this.ctx.fill(); // Fill the shape with the specified color
      }

      return;
    }
    else
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(x, y - ypadding); //Bottom Corner
      this.ctx.lineTo(x + size + xsize - xpadding, y - (xsize / 2) - size / 2); //Right Corner
      this.ctx.lineTo(x - ysize + xsize, y - (ysize / 2) - (xsize / 2) - size + ypadding); //Top Corner
      this.ctx.lineTo(x - size - ysize + xpadding, y - (ysize / 2) - size / 2); //Left Corner
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor; // Set the stroke color
      this.ctx.lineWidth = 2 * this.zoom;
      this.ctx.stroke();

      this.ctx.fillStyle = fillColor; // Set the fill color
      this.ctx.fill(); // Fill the shape with the specified color

      const objOverlay: SvgObjectOverlay = {
        points: [
            {x: x, y: y - ypadding}, // Bottom Corner
            {x: x + size + xsize - xpadding, y: y - (xsize / 2) - size / 2}, // Right Corner
            {x: x - ysize + xsize, y: y - (ysize / 2) - (xsize / 2) - size + ypadding}, // Top Corner
            {x: x - size - ysize + xpadding, y: y - (ysize / 2) - size / 2} // Left Corner
        ],
        object: obj
    };
    
    if(obj) { this.gridService.objectOverlays.push(objOverlay); }
    
    }

    //Orientation Marker
    const bottomX = x;
    const bottomY = y - ypadding - (10 * this.zoom);
    const rightX = x + size + xsize - xpadding - (20 * this.zoom);
    const rightY = y - (xsize / 2) - size / 2;
    const topX = x - ysize + xsize;
    const topY = y - (ysize / 2) - (xsize / 2) - size + ypadding + (10 * this.zoom);
    const leftX = x - size - ysize + xpadding + (20 * this.zoom);
    const leftY = y - (ysize / 2) - size / 2;

    if(orient?.includes('N'))
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(topX, topY);
      this.ctx.lineTo(rightX, rightY);
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor;
      this.ctx.lineWidth = 6 * this.zoom;
      this.ctx.stroke();
    }
    if(orient?.includes('W'))
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(topX, topY);
      this.ctx.lineTo(leftX, leftY);
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor;
      this.ctx.lineWidth = 6 * this.zoom;
      this.ctx.stroke();
    }
    if(orient?.includes('S'))
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(bottomX, bottomY);
      this.ctx.lineTo(leftX, leftY);
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor;
      this.ctx.lineWidth = 6 * this.zoom;
      this.ctx.stroke();
    }
    if(orient?.includes('E'))
    {
      this.ctx.beginPath();
      this.ctx.setLineDash([]);
      this.ctx.moveTo(bottomX, bottomY);
      this.ctx.lineTo(rightX, rightY);
      this.ctx.closePath();
      this.ctx.strokeStyle = lineColor;
      this.ctx.lineWidth = 6 * this.zoom;
      this.ctx.stroke();
    }
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
  
  @HostListener('contextmenu', ['$event']) onContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

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
    else if(event.button === 2)
    {
      event.preventDefault();
      if(this.currentHoverObject)
      {
        this.store.dispatch(new RemoveObject(this.currentHoverObject, this.gridService.getSelectedLevel()));
        //this.gridService.removeObject(this.currentHoverObject, this.gridService.getSelectedLevel());
        //this.buildingService.placeTiles();
        this.buildingService.removeTile(this.currentHoverObject, this.gridService.getSelectedLevel())
        this.gridService.redrawTiles();
        this.drawCanvas();
      }
    }
  }

  @HostListener('mouseup', ['$event']) onMouseUp(event: MouseEvent){
    if(event.which === 2 || event.button === 2)
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
    if (!this.ctx) return;
    const canvas = this.ctx.canvas;
    const rect = canvas?.getBoundingClientRect();
    const x: number = (Math.round(event.clientX - rect.left) / (rect.right - rect.left) * canvas.width);
    const y: number = (Math.round(event.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height);

    let nearestEdgeDistanceSq = Infinity;
    let nearestEdgeIndex = -1;
    let nearestEdgePoint: Point = { x: 0, y: 0 };

    this.newPositions.forEach((pos: Position) => {
        const pointToCheck: Point = { x: x, y: y };
        const found = this.pointInPolygon(pointToCheck, pos.point);
        if (found) {
            const localX = pos.localPoint.x;
            const localY = pos.localPoint.y;

            // Calculate nearest edge
            for (let i = 0; i < pos.point.length; i++) {
                const p1 = pos.point[i];
                const p2 = pos.point[(i + 1) % pos.point.length];
                const edgeVector = { x: p2.x - p1.x, y: p2.y - p1.y };
                const pointVector = { x: x - p1.x, y: y - p1.y };
                const edgeLengthSq = edgeVector.x * edgeVector.x + edgeVector.y * edgeVector.y;
                const dotProduct = (pointVector.x * edgeVector.x + pointVector.y * edgeVector.y) / edgeLengthSq;
                let edgePoint: Point;
                if (dotProduct < 0) {
                    edgePoint = p1;
                } else if (dotProduct > 1) {
                    edgePoint = p2;
                } else {
                    edgePoint = { x: p1.x + dotProduct * edgeVector.x, y: p1.y + dotProduct * edgeVector.y };
                }
                const distanceSq = (edgePoint.x - x) * (edgePoint.x - x) + (edgePoint.y - y) * (edgePoint.y - y);
                if (distanceSq < nearestEdgeDistanceSq) {
                    nearestEdgeDistanceSq = distanceSq;
                    nearestEdgeIndex = i;
                    nearestEdgePoint = edgePoint;
                }
            }

            let nearestEdge = '';
            switch(nearestEdgeIndex)
            {
              case 0:
                nearestEdge = 'E';
                break;
              case 1:
                nearestEdge = 'N';
                break;
              case 2:
                nearestEdge = 'W';
                break;
              case 3:
                nearestEdge = 'S';
                break;
              default:
                break;
            }

            

        //Check for object overlays
        let foundOverlay = false;

        this.gridService.objectOverlays.forEach((obj) => {
            const foundOverlayInCurrentIteration = this.pointInPolygon(pointToCheck, obj.points);
            if (foundOverlayInCurrentIteration) {
                foundOverlay = true;
                if (this.currentHoverObject !== obj.object) {
                    this.currentHoverObject = obj.object;
                    this.drawCanvas();
                }
            }
        });

        if (!foundOverlay && this.currentHoverObject) {
            this.currentHoverObject = undefined;
            this.drawCanvas();
        }

            this.hoverTile(localX, localY, nearestEdge, ''); // Perform hover action
        }
    });

    if(nearestEdgeIndex == -1)
    {
      this.gridService.showAllTiles();
      this.gridService.redrawTiles();
      this.drawCanvas();
    }

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

interface Position {
  point: Point[];
  localPoint: Point;

}