import { HttpClient } from "@angular/common/http";
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from "@angular/core";
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
import { RemoveObject, ScheduleRedraw, UpdateObject, Undo, Redo } from "../app.actions";
import { historyShortcut, isTextEditing } from '../utils/editor-shortcuts';
import ToolDoor from "../tools/tool-door";
import { DoorService } from "../services/door.service";
import ToolWindow from "../tools/tool-window";
import { WindowService } from "../services/window.service";
import ToolFurniture from "../tools/tool-furniture";
import ToolRoof from "../tools/tool-roof";
import { RoofService } from "../services/roof.service";
import ToolSelect from '../tools/tool-select';
import ToolWall from '../tools/tool-wall';
import ToolStairs from '../tools/tool-stairs';
import { ToolSettingsService } from '../services/tool-settings.service';
import { fractionalCellPosition, nativeTileEdge, nativeWallCorner } from '../utils/native-pointer';
import { buildingCameraBounds, constrainCamera, nativeWheelZoom, safeZoom, wheelAngle, wheelScroll, zoomAroundPoint } from '../utils/native-camera';

@Component({
    selector: 'app-viewport-canvas',
    templateUrl: './viewport-canvas.component.html',
    styleUrls: ['./viewport-canvas.component.scss']
})
export class ViewportCanvasComponent implements OnInit, AfterViewInit, OnDestroy{
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
  private readonly mouseMove = (event: MouseEvent) => this.getMousePos(event);

  currentHoverCoords: Point = {x: 0, y: 0};
  currentHoverCoordSegments = {edge: '', corner: ''}
  currentHoverObject: SvgObject | undefined = undefined;
  currentHoverOverlay: SvgObjectOverlay | undefined = undefined;
  currentHoverSubOverlay: SvgObjectOverlay | undefined = undefined;

  newPositions: Position[] = [];

  screenWidth: number = 0;
  screenHeight: number = 0;

  xOffset: number = 0;
  yOffset: number = 0;
  zoom: number = 1;
  private cameraInitialized = false;
  private cameraLevel = 0;
  private resizeObserver?: ResizeObserver;

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
    private roofService: RoofService,
    public toolSettings: ToolSettingsService = new ToolSettingsService())
  { 
    this.selectedTool$ = store.select(fromRoot.getCurrentTool);
    this.scheduleRedraw$ = store.select(fromRoot.getRedrawSchedule);

    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;

    this.cameraLevel = this.gridService.getSelectedLevel();
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
      this.selectedTool.cancel();
      switch(x)
      {
        case 'tool-tile':
          this.selectedTool = new ToolTile(this.gridService, this.store, this.toolSettings);
          break;
        case 'tool-select-objects':
        case 'tool-select-rooms':
        case 'tool-select-tiles':
          this.selectedTool = new ToolSelect(x.replace('tool-select-', '') as 'objects' | 'rooms' | 'tiles', this.gridService, this.buildingService, this.store, this.toolSettings);
          break;
        case 'tool-wall':
          this.selectedTool = new ToolWall(this.buildingService, this.gridService, this.store, this.toolSettings);
          break;
        case 'tool-stairs':
          this.selectedTool = new ToolStairs(this.buildingService, this.gridService, this.store, this.toolSettings);
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
      this.selectedTool.key = this.key;
    });

    let documentId = -1;
    this.store.select(fromRoot.getDocumentProjection).pipe(takeUntil(this.unsubscribe)).subscribe(document => {
      this.cancelGesture();
      if (documentId !== document.documentId) {
        documentId = document.documentId; this.selectedTool.reset();
        this.cameraInitialized = false;
        this.toolSettings.exterior = this.toolSettings.interior = this.toolSettings.exteriorTrim = this.toolSettings.interiorTrim = this.toolSettings.stairs = null;
        this.toolSettings.stamp = undefined;
      }
    });
    this.gridService.selectedLevelChanges.pipe(takeUntil(this.unsubscribe)).subscribe(level => {
      // The web renderer rebases all floors around the selected level; keep the camera in world space.
      this.yOffset += (level - this.cameraLevel) * 300; this.cameraLevel = level;
      this.cancelGesture(); this.selectedTool.reset();
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
    canvas.addEventListener("mousemove", this.mouseMove);
    this.resizeViewport();
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => { if (this.resizeViewport()) this.drawCanvas(); });
      this.resizeObserver.observe(canvas.parentElement);
      const toolbar = document.querySelector('app-menu');
      if (toolbar) this.resizeObserver.observe(toolbar);
    }

    if(this.ctx)
    {
      this.ctx.imageSmoothingEnabled = false;
    }

    this.drawCanvas();
    this.loadBuildingXmlFromLocalStorage();
  }

  ngOnDestroy(): void {
    this.stopPanning();
    this.resizeObserver?.disconnect();
    this.selectedTool.cancel();
    this.unsubscribe.next();
    this.unsubscribe.complete();
    this.canvasElement?.nativeElement.removeEventListener('mousemove', this.mouseMove);
  }

  cancelGesture(): void {
    this.selectedTool.cancel();
    if (this.canvasElement?.nativeElement) this.canvasElement.nativeElement.style.cursor = 'default';
    this.currentHoverObject = undefined;
    this.currentHoverOverlay = undefined;
    this.currentHoverSubOverlay = undefined;
  }

  private deleteHoveredObject(): void {
    if (this.selectedTool.isDragging) { this.cancelGesture(); return; }
    if (this.selectedTool.deleteSelection()) { this.gridService.redrawTiles(); return; }
    const object = this.currentHoverObject;
    if (object && object.level === this.gridService.getSelectedLevel()) this.store.dispatch(new RemoveObject(object.uid));
    this.cancelGesture();
  }

  loadBuildingXmlFromLocalStorage() {
    const xmlString = localStorage.getItem('buildingXml');
    if (xmlString) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
        this.buildingService.createBuildingFromXml(xmlDoc).catch(error => window.alert(error.message || String(error)));
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

    else if(this.currentHoverCoords.x == x && this.currentHoverCoords.y == y && !(this.selectedTool instanceof ToolWall) && !(this.selectedTool instanceof ToolStairs) && !(this.selectedTool instanceof ToolRoof))
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
    if(hoverRoom && !(this.selectedTool instanceof ToolSelect) && !(this.selectedTool instanceof ToolWall) && !(this.selectedTool instanceof ToolStairs))
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

    this.selectedTool.hoveredObject = this.currentHoverObject;
    this.selectedTool.hoverTile(x, y, closestEdge, closestCorner);
    if (this.canvasElement?.nativeElement) this.canvasElement.nativeElement.style.cursor = this.selectedTool.cursor;

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

  private cameraBounds() {
    return buildingCameraBounds(this.buildingService.building, this.gridService.getSelectedLevel(), [...this.gridService.roomTiles, ...this.gridService.userTiles]);
  }
  private constrainViewport(): void {
    const canvas = this.canvasElement?.nativeElement as HTMLCanvasElement | undefined;
    if (!canvas) return;
    this.zoom = safeZoom(this.zoom);
    const bounds = this.cameraBounds();
    if (!this.cameraInitialized && this.ctx) {
      this.xOffset = (bounds.left + bounds.right - canvas.width / this.zoom) / 2;
      this.yOffset = (bounds.top + bounds.bottom - canvas.height / this.zoom) / 2;
      this.cameraInitialized = true;
    }
    const offset = constrainCamera({ x: this.xOffset, y: this.yOffset }, this.zoom, bounds, canvas);
    this.xOffset = offset.x; this.yOffset = offset.y;
  }
  @HostListener('window:resize') onViewportResize(): void { if (this.resizeViewport()) this.drawCanvas(); }
  private resizeViewport(): boolean {
    const canvas = this.canvasElement?.nativeElement as HTMLCanvasElement | undefined;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(canvas.parentElement?.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.floor(window.innerHeight - rect.top));
    if (canvas.width === width && canvas.height === height) return false;
    if (this.cameraInitialized) {
      this.xOffset += (canvas.width - width) / (2 * safeZoom(this.zoom));
      this.yOffset += (canvas.height - height) / (2 * safeZoom(this.zoom));
    }
    canvas.width = this.screenWidth = width; canvas.height = this.screenHeight = height;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this.constrainViewport(); return true;
  }

  drawCanvas() {
    if (!this.ctx) return;
    this.constrainViewport();
    //Clear canvas
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
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
    this.gridService.redrawTiles(this.selectedTool?.previewTiles);

    if (this.selectedTool instanceof ToolDraw) {
      this.selectedTool.tileGhosts.forEach((tile: SvgTile) => {
          if (tile.level !== this.gridService.getSelectedLevel()) return;
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
      if(!tile.hidden && !tile.excluded && this.gridService.layerView(tile.layer, tile.level).visible)
      {
        if(!drawnDarkOverlay && this.gridService.getSelectedLevel() == tile.level && this.ctx)
        {
          const canvas: HTMLCanvasElement = this.canvasElement.nativeElement
          drawnDarkOverlay = true;
          this.ctx.fillStyle = 'rgba(52, 52, 52, 0.5)';
          this.ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const tileImage = this.getIndividualTile(tile.name!);
        this.drawTile(tile.x + (tile.offsetX ?? 0), tile.y + (tile.offsetY ?? 0), tile.name!, tileImage as string,
          this.gridService.layerView(tile.layer, tile.level).opacity);
      }
    });

    
  }

  drawTile(x: number, y: number, tileName: string, tile: string, opacity = 1) {
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
        // Redraw using the current layer visibility and camera after the image loads.
        this.store.dispatch(new ScheduleRedraw(true));
      }
    }
    else
    {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(tileImage,x, y, size * this.zoom, size * 2 * this.zoom);
      ctx.restore();
    }
  }

  drawTileOverlays() {
    this.gridService.objectOverlays = [];
    this.gridService.objects.forEach((obj: SvgObject) => {   
      if(obj.level === this.gridService.getSelectedLevel() && !(this.selectedTool instanceof ToolRoof && this.selectedTool.resizingUid === obj.uid))
      {
        const isRoof = obj.type === 'roof';
        const isHoveredRoof = isRoof && obj.uid === this.currentHoverObject?.uid;
        this.drawOverlayBlock(obj.x, obj.y, obj.length ?? 0, obj.width ?? 0,
          '#1d1aeb60', isHoveredRoof ? '#ffffff60' : '#ffffff30', obj.orient, obj.type, obj);
      }
    });
  }

  drawOverlay() {
    for (const overlay of this.selectedTool.overlays) {
      if (!this.ctx || !overlay.points.length) continue;
      this.ctx.beginPath(); this.ctx.setLineDash([]);
      overlay.points.forEach((p, i) => {
        const x = (2500 + p.x * 100 - p.y * 100 - this.xOffset) * this.zoom;
        const y = (p.x * 50 + p.y * 50 - this.yOffset) * this.zoom;
        if (i === 0) this.ctx!.moveTo(x, y); else this.ctx!.lineTo(x, y);
      });
      this.ctx.closePath(); this.ctx.fillStyle = overlay.fill; this.ctx.fill();
      this.ctx.strokeStyle = overlay.stroke; this.ctx.lineWidth = 1; this.ctx.stroke();
      if (overlay.crossed) {
        this.ctx.beginPath();
        for (const [a, b] of [[0, 2], [1, 3]]) {
          const first = overlay.points[a], last = overlay.points[b];
          this.ctx.moveTo((2500 + first.x * 100 - first.y * 100 - this.xOffset) * this.zoom, (first.x * 50 + first.y * 50 - this.yOffset) * this.zoom);
          this.ctx.lineTo((2500 + last.x * 100 - last.y * 100 - this.xOffset) * this.zoom, (last.x * 50 + last.y * 50 - this.yOffset) * this.zoom);
        }
        this.ctx.stroke();
      } else if (overlay.label) {
        const center = overlay.points.reduce((p, q) => ({ x: p.x + q.x / overlay.points.length, y: p.y + q.y / overlay.points.length }), { x: 0, y: 0 });
        this.ctx.fillStyle = '#000'; this.ctx.font = `${14 * this.zoom}px sans-serif`; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
        this.ctx.fillText(overlay.label, (2500 + center.x * 100 - center.y * 100 - this.xOffset) * this.zoom, (center.x * 50 + center.y * 50 - this.yOffset) * this.zoom);
      }
    }
    if(this.selectedTool instanceof ToolDraw && !(this.selectedTool instanceof ToolDoor) && !(this.selectedTool instanceof ToolWindow))
    {
      this.selectedTool.dragTiles.forEach((tile: SvgTile) => {
        this.drawOverlaySquare(tile.x, tile.y, 'black', this.selectedTool.getTileFill(tile.x, tile.y));
      });
    }
  }

  drawIsometricGrid(length: number, width: number) {
    if (this.selectedTool instanceof ToolTile || this.selectedTool instanceof ToolSelect && this.selectedTool.mode === 'tiles') { length++; width++; }
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
  private isPanning = false;

  private stopPanning(): void {
    this.isPanning = false;
    const canvas = this.canvasElement?.nativeElement || this.ctx?.canvas;
    if (canvas) canvas.style.cursor = this.selectedTool.cursor;
  }

  @HostListener('document:mousemove', ['$event']) onDocumentMouseMove(event: MouseEvent): void {
    // Canvas moves are already handled by its mousemove listener.
    if (this.isPanning && !this.canvasElement?.nativeElement.contains(event.target)) this.getMousePos(event);
  }
  
  @HostListener('contextmenu', ['$event']) onContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  @HostListener('mousedown', ['$event']) onMouseDown(event: MouseEvent){
    if (event.button === 1) {
      event.preventDefault();
      this.isPanning = true;
      this.dragStartPos = { x: event.clientX, y: event.clientY };
      const canvas = this.canvasElement?.nativeElement || this.ctx?.canvas;
      if (canvas) canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.isPanning) { event.preventDefault(); return; }
    this.selectedTool.modifiers = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    this.selectedTool.hoveredObject = this.currentHoverObject;
    this.selectedTool.key = event.ctrlKey ? 'Control' : '';
    if(event.button === 0)
    {
      event.preventDefault();
      this.beginDrag(event, this.currentHoverCoords.x, this.currentHoverCoords.y);
      this.drawCanvas();
    }
    else if(event.button === 2)
    {
      event.preventDefault();
      if (this.selectedTool.isDragging) this.cancelGesture();
      else if (this.selectedTool instanceof ToolTile) this.selectedTool.beginCapture(this.currentHoverCoords.x, this.currentHoverCoords.y);
      else if (this.selectedTool instanceof ToolSelect) this.selectedTool.reset();
      else this.deleteHoveredObject();
      this.drawCanvas();
    }
  }

  @HostListener('document:mouseup', ['$event']) onMouseUp(event: MouseEvent){
    if (event.button === 1) {
      event.preventDefault(); this.stopPanning(); return;
    }
    if (!this.selectedTool.isDragging) return;
    if (!this.canvasElement?.nativeElement.contains(event.target)) {
      this.cancelGesture(); this.drawCanvas(); return;
    }
    if (event.button === 2 && this.selectedTool instanceof ToolTile && this.selectedTool.capturing) {
      this.endDrag({ button: 0 } as MouseEvent, this.currentHoverCoords.x, this.currentHoverCoords.y); return;
    }
    if(event.button === 2)
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
    const canvas = this.canvasElement?.nativeElement as HTMLCanvasElement | undefined;
    if (!canvas || (event.target && event.target !== canvas) || (!event.deltaX && !event.deltaY)) return;
    event.preventDefault();
    this.constrainViewport();
    if (event.ctrlKey && event.deltaY) {
      const zoom = nativeWheelZoom(this.zoom, wheelAngle(event.deltaY, event.deltaMode));
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: (event.clientX - rect.left) * (rect.width ? canvas.width / rect.width : 1),
        y: (event.clientY - rect.top) * (rect.height ? canvas.height / rect.height : 1) };
      const offset = zoomAroundPoint({ x: this.xOffset, y: this.yOffset }, this.zoom, zoom, anchor);
      this.xOffset = offset.x; this.yOffset = offset.y; this.zoom = zoom;
    } else {
      this.xOffset += wheelScroll(event.deltaX || (event.shiftKey ? event.deltaY : 0), event.deltaMode, canvas.width) / this.zoom;
      if (!event.shiftKey) this.yOffset += wheelScroll(event.deltaY, event.deltaMode, canvas.height) / this.zoom;
    }
    this.constrainViewport(); this.drawCanvas();
  }

  getMousePos(event: MouseEvent) {
    if (this.isPanning) {
      if (event.buttons & 4) {
        event.preventDefault();
        const canvas = this.canvasElement?.nativeElement || this.ctx?.canvas;
        const rect = canvas?.getBoundingClientRect();
        const scaleX = rect?.width ? canvas.width / rect.width : 1;
        const scaleY = rect?.height ? canvas.height / rect.height : 1;
        this.xOffset -= (event.clientX - this.dragStartPos.x) * scaleX / this.zoom;
        this.yOffset -= (event.clientY - this.dragStartPos.y) * scaleY / this.zoom;
        this.dragStartPos = { x: event.clientX, y: event.clientY };
        this.constrainViewport();
        this.drawCanvas();
        return; // Do not move the tool's endpoint while moving the camera.
      }
      this.stopPanning(); // Recover if a release outside the browser was missed.
    }
    if (!this.ctx) return;
    const canvas = this.ctx.canvas;
    const rect = canvas?.getBoundingClientRect();
    const x: number = (Math.round(event.clientX - rect.left) / (rect.right - rect.left) * canvas.width);
    const y: number = (Math.round(event.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height);

    let nearestEdgeIndex = -1;

    this.newPositions.forEach((pos: Position) => {
        const pointToCheck: Point = { x: x, y: y };
        const found = this.pointInPolygon(pointToCheck, pos.point);
        if (found) {
            const localX = pos.localPoint.x;
            const localY = pos.localPoint.y;

            const fraction = fractionalCellPosition(pointToCheck, pos.point);
            const nearestEdge = nativeTileEdge(fraction);
            nearestEdgeIndex = ['E', 'N', 'W', 'S'].indexOf(nearestEdge);
            this.selectedTool.pointerPosition = { x: localX + fraction.x, y: localY + fraction.y };

        //Check for object overlays
        let foundOverlay = false;

        this.gridService.objectOverlays.forEach((obj) => {
            const foundOverlayInCurrentIteration = this.pointInPolygon(pointToCheck, obj.points);
            if (foundOverlayInCurrentIteration) {
                foundOverlay = true;
                if(this.currentHoverSubOverlay)
                  {
                    const foundSubOverlay = this.pointInPolygon(pointToCheck, this.currentHoverSubOverlay?.points);
                    if(!foundSubOverlay)
                    {
                      this.currentHoverSubOverlay = undefined;
                      this.drawCanvas();
                    }
                  }
                if(obj.func)
                {
                  if(obj.func.includes('capped') && !(this.selectedTool instanceof ToolRoof))
                  {
                    this.drawCanvas();
                  }
                  else if(this.currentHoverSubOverlay !== obj)
                  {
                    this.currentHoverSubOverlay = obj;
                    this.drawCanvas();
                  }
                }
                else if (this.currentHoverOverlay !== obj) {
                    this.currentHoverObject = obj.object;
                    this.currentHoverOverlay = obj;
                    this.drawCanvas();
                }
            }
        });

        if (!foundOverlay && this.currentHoverObject) {
            this.currentHoverObject = undefined;
            this.currentHoverOverlay = undefined;
            this.currentHoverSubOverlay = undefined;
            this.drawCanvas();
        }

            this.hoverTile(localX, localY, nearestEdge, nativeWallCorner(fraction));
        }
    });

    if(nearestEdgeIndex == -1)
    {
      this.selectedTool.pointerPosition = undefined;
      if (!this.selectedTool.isDragging && (this.selectedTool instanceof ToolWall || this.selectedTool instanceof ToolStairs || this.selectedTool instanceof ToolRoof)) this.selectedTool.cancel();
      canvas.style.cursor = 'default';
      this.currentHoverObject = undefined;
      this.currentHoverOverlay = undefined;
      this.currentHoverSubOverlay = undefined;
      this.gridService.showAllTiles();
      this.gridService.redrawTiles();
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

  arePointsEqual(objOverlayPoints: {x: number, y: number}[], currentHoverOverlayPoints: {x: number, y: number}[] | undefined): boolean {
    if (!currentHoverOverlayPoints || objOverlayPoints.length !== currentHoverOverlayPoints.length) {
      return false;
    }
  
    for (let i = 0; i < objOverlayPoints.length; i++) {
      if (objOverlayPoints[i].x !== currentHoverOverlayPoints[i].x || objOverlayPoints[i].y !== currentHoverOverlayPoints[i].y) {
        return false;
      }
    }
  
    return true;
  }

  //Keyboard functions
  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) { 
    if (isTextEditing(event)) return;
    const history = historyShortcut(event);
    if (history) {
      event.preventDefault();
      this.cancelGesture();
      this.store.dispatch(history === 'undo' ? new Undo() : new Redo());
      this.drawCanvas(); return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.selectedTool.isDragging) this.selectedTool.reset();
      this.cancelGesture(); this.drawCanvas(); return;
    }
    if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); this.deleteHoveredObject(); this.drawCanvas(); return;
    }
    this.key = event.ctrlKey ? 'Control' : event.key;
    this.selectedTool.key = this.key;
    this.selectedTool.modifiers = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    if (this.selectedTool.keyDown(event.key)) event.preventDefault();
    this.selectedTool.hoverTile(this.currentHoverCoords.x, this.currentHoverCoords.y, this.currentHoverCoordSegments.edge, this.currentHoverCoordSegments.corner);
    this.drawCanvas();
  }

  @HostListener('document:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) { 
    this.key = event.ctrlKey ? 'Control' : '';
    this.selectedTool.key = this.key;
    this.selectedTool.modifiers = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    this.drawCanvas();
  }

  @HostListener('window:blur') onBlur(): void {
    this.stopPanning();
    this.key = ''; this.selectedTool.key = '';
    this.selectedTool.modifiers = { ctrl: false, shift: false, alt: false };
    this.cancelGesture(); this.drawCanvas();
  }

  
}

interface Position {
  point: Point[];
  localPoint: Point;

}
