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

    fetchedTiles: PngTile[] = [];
    fetchingTiles: string[] = [];

    constructor(private db: DbService, private cacheService: CacheService) { }


    hideTile(x: number, y: number, layer: string)
    {
        const roomTile = this.roomTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.layer === layer;});
        if(roomTile)
        {
          roomTile.hidden = true;
        }

        const tile = this.userTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.layer === layer;});
        if(tile)
        {
          tile.hidden = true;
        }
    }

    showTile(x: number, y: number, layer: string)
    {
        const roomTile = this.roomTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.layer === layer;});
        if(roomTile)
        {
          roomTile.hidden = false;
        }

        const tile = this.userTiles.find((tile: SvgTile) => {return tile.x === x && tile.y === y && tile.layer === layer;});
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

    redrawTiles() {
        this.tiles = [];
        const level = this.getSelectedLevel();

        this.roomTiles.forEach((tile: SvgTile) => {
          if(!tile.hidden && tile.level === level)
          {
            this.placeTile_old(tile.x, tile.y, tile.offsetX ? tile.offsetX : 0, tile.offsetY ? tile.offsetY : 0, tile.name, tile.layer);
          }
        });
    
        this.userTiles.forEach((tile: SvgTile) => {
          if(!tile.hidden && tile.level === level)
          {
            this.placeTile_old(tile.x, tile.y, tile.offsetX ? tile.offsetX : 0, tile.offsetY ? tile.offsetY : 0, tile.name, tile.layer);
          }
        });

        //Sort roomTiles by x and then y
        this.tiles.sort((a: SvgTile, b: SvgTile) => {
          if(a.x === b.x)
          {
              return a.y - b.y;
          }
          else
          {
              return a.x - b.x;
          }
      });
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


      //this.redrawTiles();
  }

  placeTile_old(x: number, y: number, xOffset: number, yOffset: number, name: string = '', layer: string = 'Walls', level: number = 0) {

    if(name === '')
    {
      name = localStorage.getItem('selectedTile')!;
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
      level: level,
      offsetX: xOffset,
      offsetY: yOffset,
      layer: layer,
    };

    this.tiles.push(tile);
    //this.tileGhosts = [];
  }

  sortTiles() {
    this.tiles.sort((a: SvgTile, b: SvgTile) => {
      if(a.x === b.x)
      {
          return a.y - b.y;
      }
      else
      {
          return a.x - b.x;
      }
    });
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