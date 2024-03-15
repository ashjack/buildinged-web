import { Injectable } from "@angular/core";
import { GridRoom, SvgTile } from "../models/app.models";
import ToolDrawRoom from "../tools/tool-draw-room";
import { DbService, PngTile } from "./db.service";
import { SafeResourceUrl } from "@angular/platform-browser";
import { CacheService } from "./cache.service";

@Injectable({
    providedIn: 'root',
  })
export class GridService {
    //rooms: GridRoom[] = [];

    rowArray = Array(20).fill(0).map((x,i)=>i);
    colArray = Array(20).fill(0).map((x,i)=>i);

    roomTiles: SvgTile[] = [];
    userTiles: SvgTile[] = [];
    tiles: SvgTile[] = [];
    hiddenTiles: SvgTile[] = [];
    excludedTiles: SvgTile[] = []; //Tiles that are permenantly hidden but still technically part of the building e.g. hidden walls

    fetchedTiles: PngTile[] = [];
    fetchingTiles: string[] = [];

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

    redrawTiles() {
      this.tiles = [];
      const level = this.getSelectedLevel();
  
      // Draw lower layers offset & greyed out
      this.roomTiles.forEach((tile: SvgTile) => {
          if (!tile.hidden && !tile.excluded && tile.level <= level) {
              const offsetX = 3 * (level - tile.level);
              const offsetY = 3 * (level - tile.level);
              this.placeTile_old(tile.x + offsetX, tile.y + offsetY, tile.level, tile.offsetX ? tile.offsetX : 0, tile.offsetY ? tile.offsetY : 0, tile.name, tile.layer);
          }
      });
  
      this.userTiles.forEach((tile: SvgTile) => {
          if (!tile.hidden && !tile.excluded && tile.level <= level) {
              const offsetX = 3 * (level - tile.level);
              const offsetY = 3 * (level - tile.level);
              this.placeTile_old(tile.x + offsetX, tile.y + offsetY, tile.level, tile.offsetX ? tile.offsetX : 0, tile.offsetY ? tile.offsetY : 0, tile.name, tile.layer);
          }
      });
  
      // Sort tiles by level first (lower levels first), then by x and then y
      this.sortTiles();
  }
  
  

    placeTile2(tile: SvgTile, isRoom: boolean)
    {
      if(isRoom)
      {
        //check if roomTiles contains tile
        if(this.roomTiles.some((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer && roomTile.level == tile.level;}))
        {
          const roomTile = this.roomTiles.find((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer && roomTile.level == tile.level;});
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

  placeTile_old(x: number, y: number, level: number, xOffset: number, yOffset: number, name: string = '', layer: string = 'Walls') {

    if(name === '')
    {
      name = localStorage.getItem('selectedTile')!;
    }

    if(this.tileExists(x, y, level, layer))
    {
      //edit tile name and url
      const tile = this.getTileAt(x, y, level, layer);
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
      level: level,
      offsetX: xOffset,
      offsetY: yOffset,
      layer: layer,
    };

    this.tiles.push(tile);
    //this.tileGhosts = [];
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


  removeTile(x: number, y: number, level: number, layer: string) {
    this.tiles = this.tiles.filter((tile: SvgTile) => {
      return tile.x !== x || tile.y !== y && tile.layer !== layer;
    });
  }

  getTileAt(x: number, y: number, level: number, layer: string): SvgTile | undefined {
    return this.tiles.find((tile: SvgTile) => {
      return tile.x === x && tile.y === y && tile.level === level && tile.layer === layer;
    });
  }

  tileExists(x: number, y: number, level: number, layer: string): boolean {
    return this.tiles.some((tile: SvgTile) => {
      return tile.x === x && tile.y === y && tile.level === level && tile.layer == layer;
    });
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
      console.log(level);
      localStorage.setItem('selectedLevel', level.toString());
    }

}