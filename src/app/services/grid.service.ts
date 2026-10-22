import { Injectable } from "@angular/core";
import { SvgObject, SvgObjectOverlay, SvgTile } from "../models/app.models";
import { DbService, PngTile } from "./db.service";
import { SafeResourceUrl } from "@angular/platform-browser";
import { CacheService } from "./cache.service";
import { Subject } from 'rxjs';

@Injectable({
    providedIn: 'root',
  })
export class GridService {
    // Display preferences belong to each floor, independently of document tile data.
    private layerViews = new Map<string, { visible: boolean; opacity: number }>();
    layerView(layer: string, level = this.getSelectedLevel()) {
        return this.layerViews.get(`${level}:${layer}`) ?? { visible: true, opacity: 1 };
    }
    setLayerView(layer: string, value: Partial<{ visible: boolean; opacity: number }>, level = this.getSelectedLevel()): void {
        this.layerViews.set(`${level}:${layer}`, { ...this.layerView(layer, level), ...value });
    }
    resetLayerViews(): void { this.layerViews.clear(); }
    readonly selectedLevelChanges = new Subject<number>();
    //rooms: GridRoom[] = [];

    roomTiles: SvgTile[] = [];
    userTiles: SvgTile[] = [];
    tiles: SvgTile[] = [];
    hiddenTiles: SvgTile[] = [];
    excludedTiles: SvgTile[] = []; //Tiles that are permenantly hidden but still technically part of the building e.g. hidden walls

    objects: SvgObject[] = [];
    objectOverlays: SvgObjectOverlay[] = [];

    fetchedTiles: PngTile[] = [];
    fetchingTiles: string[] = [];

    private rebuilding = false;
    private objectUid: string | undefined;

    beginRebuild(): void {
        this.rebuilding = true;
        this.roomTiles = [];
        this.userTiles = [];
        this.tiles = [];
        this.objects = [];
        this.objectOverlays = [];
        this.hiddenTiles = [];
        this.excludedTiles = [];
    }

    endRebuild(): void {
        this.rebuilding = false;
        this.redrawTiles();
    }

    renderObject(uid: string, render: () => unknown): void {
        this.objectUid = uid;
        try { render(); } finally { this.objectUid = undefined; }
    }

    constructor(private db: DbService, private cacheService: CacheService) { }


    hideTile(x: number, y: number, level: number, layer: string)
    {
        const roomTile = this.roomTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.level == level && tile.layer === layer;});
        if(roomTile)
        {
          roomTile.hidden = true;
        }

        const tile = this.userTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.level == level && tile.layer === layer;});
        if(tile)
        {
          tile.hidden = true;
        }
    }

    showTile(x: number, y: number, level: number, layer: string)
    {
        const roomTile = this.roomTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.level == level && tile.layer === layer;});
        if(roomTile)
        {
          roomTile.hidden = false;
        }

        const tile = this.userTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.level == level && tile.layer === layer;});
        if(tile)
        {
          tile.hidden = false;
        }
    }

    showAllTiles()
    {
      this.roomTiles.forEach((tile: SvgTile) => {
        tile.hidden = false;
      });

      this.userTiles.forEach((tile: SvgTile) => {
        tile.hidden = false;
      });
    }

    excludeTile(x: number, y: number, level: number, layer: string)
    {
        const roomTile = this.roomTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.level == level && tile.layer === layer;});
        if(roomTile)
        {
          roomTile.excluded = true;
        }

        const tile = this.userTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.level == level && tile.layer === layer;});
        if(tile)
        {
          tile.excluded = true;
        }
    }

    redrawTiles(generated: SvgTile[] = this.roomTiles): void {
      if (this.rebuilding) return;
      const level = this.getSelectedLevel();
      const tiles = new Map<string, SvgTile>();
      // Object tiles override automatic room tiles; manual tiles override both.
      for (const source of [...generated.filter(tile => tile.auto), ...generated.filter(tile => !tile.auto), ...this.userTiles]) {
        if (source.hidden || source.excluded || source.level > level) continue;
        const difference = level - source.level;
        const tile = {
          ...source,
          x: source.x + 3 * difference, y: source.y + 3 * difference,
          offsetX: (source.offsetX || 0) + difference * 0.05,
          offsetY: (source.offsetY || 0) + difference * 0.05,
          url: this.getIndividualTile(source.name!),
        };
        tiles.set([tile.level, tile.x, tile.y, tile.layer].join(':'), tile);
      }
      this.tiles = [...tiles.values()];
      this.sortTiles();
    }

    placeTile2(tile: SvgTile, isRoom: boolean)
    {
      if (this.objectUid) {
        tile = { ...tile, object: this.objectUid };
        isRoom = true;
      }
      if (!tile.name || tile.name === 'undefined.png') return;
      if(isRoom)
      {
        //check if roomTiles contains tile
        if(this.roomTiles.some((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer && roomTile.level == tile.level && roomTile.object == tile.object;}))
        {
          const roomTile = this.roomTiles.find((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer && roomTile.level == tile.level && roomTile.object == tile.object;});
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
        if(this.userTiles.some((userTile: SvgTile) => {return userTile.x === tile.x && userTile.y === tile.y && userTile.layer == tile.layer && userTile.level == tile.level;}))
        {
          const userTile = this.userTiles.find((userTile: SvgTile) => {return userTile.x === tile.x && userTile.y === tile.y && userTile.layer === tile.layer && userTile.level == tile.level;});
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

  addObject(obj: SvgObject): void {
    const previous = this.objects.findIndex(object => object.uid === obj.uid);
    if (previous < 0) this.objects.push(obj);
    else this.objects[previous] = obj;
  }

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

  sortTiles() {
    this.tiles = this.tiles.sort((a: SvgTile, b: SvgTile) => {
        // First, compare levels
        if (a.level !== b.level) {
            return a.level - b.level;
        }

        // Then, compare x and y coordinates
        if (a.x === b.x) {
            if (a.y === b.y) {
                // If x and y coordinates are the same, compare layers
                const layerIndexA = this.layers.indexOf(a.layer);
                const layerIndexB = this.layers.indexOf(b.layer);

                // If both layers are found in the layers array, sort based on their index positions
                if (layerIndexA !== -1 && layerIndexB !== -1) {
                    return layerIndexA - layerIndexB;
                } else if (layerIndexA !== -1) {
                    // If only layer A is found, it should be drawn before layer B (which is not found)
                    return -1;
                } else if (layerIndexB !== -1) {
                    // If only layer B is found, it should be drawn after layer A (which is not found)
                    return 1;
                } else {
                    // If neither layer is found, maintain the current order
                    return 0;
                }
            } else {
                return a.y - b.y;
            }
        } else {
            return a.x - b.x;
        }
    });
}


  getTileAt(x: number, y: number, level: number, layer: string): SvgTile | undefined {
    const matches = (tile: SvgTile) => tile.x === x && tile.y === y && tile.level === level && tile.layer === layer;
    return this.userTiles.find(matches) || [...this.roomTiles].reverse().find(matches);
  }

  getObjectFromTile(x: number, y: number, level: number, layer: string): SvgObject | undefined {
    return this.objects.find((obj: SvgObject) => {
        return obj.tiles.some((tile: SvgTile) => {
          return tile.x === x && tile.y === y && tile.level === level && tile.layer === layer;
        }) && obj.tiles.length > 0;
    });
}

  getObjectAt(x: number, y: number, level: number, type: string, orient?: string): SvgObject | undefined {
    return this.objects.find(obj => obj.x === x && obj.y === y && obj.level === level && obj.type === type &&
                                    (obj.orient === orient || !orient))
  }

  tileExists(x: number, y: number, level: number, layer: string): boolean {
    return this.getTileAt(x, y, level, layer) !== undefined;
  }

  tileHidden(x: number, y: number, level: number, layer: string): boolean {
    const tile = this.getTileAt(x, y, level, layer);
    if(tile)
    {
      return tile.hidden!;
    }
    return false;
  }

  isUserTile(x: number, y: number, level: number, layer: string): boolean {
    return this.userTiles.some((tile: SvgTile) => {
      return tile.x === x && tile.y === y && tile.level === level && tile.layer === layer;
    });
  }

  //Combination of tileExists and isUserTile
  canOverrideTile(x: number, y: number, level: number, layer: string): boolean {
    return this.tileExists(x, y, level, layer) && !this.isUserTile(x, y, level, layer)
  }

  getIndividualTile(name: string, origin = 'undefined'): SafeResourceUrl {
  
    // const tileName = name;
    // const tileUrl = localStorage.getItem(tileName);
    // return tileUrl!;

   if(!name)
   {
     return 'NULL';
   }
   
    const existingTile = this.fetchedTiles.find((tile: PngTile) => {return tile.name === name;});
     if(existingTile)
     {
       this.fetchingTiles = this.fetchingTiles.filter((tile: string) => {return tile !== name;});
       return existingTile.url!;
     }

     if(this.fetchingTiles.includes(name))
   {
     return 'AWAITING';
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

       return 'NULL 2';
     });

     return '';
   }

    getSelectedLevel(): number {
      return parseInt(localStorage.getItem('selectedLevel') || '0');
    }

    setSelectedLevel(level: number) {
      const changed = this.getSelectedLevel() !== level;
      localStorage.setItem('selectedLevel', level.toString());
      if (changed) this.selectedLevelChanges.next(level);
    }

    public getFullDir(dir: string): string
    {
        switch(dir)
        {
            case 'N':
                return 'North';
            case 'S':
                return 'South';
            case 'E':
                return 'East';
            case 'W':
                return 'West';
            case 'NE':
                return 'NorthEast';
            case 'NW':
                return 'NorthWest';
            case 'SE':
                return 'SouthEast';
            case 'SW':
                return 'SouthWest';
            default:
                return '';
        }
    }

}
