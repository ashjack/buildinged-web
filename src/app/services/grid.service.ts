import { Injectable } from "@angular/core";
import { GridRoom, SvgTile } from "../models/app.models";
import ToolDrawRoom from "../tools/tool-draw-room";
import { DbService, PngTile } from "./db.service";
import { SafeResourceUrl } from "@angular/platform-browser";

@Injectable({
    providedIn: 'root',
  })
export class GridService {
    //rooms: GridRoom[] = [];
    roomTiles: SvgTile[] = [];
    userTiles: SvgTile[] = [];
    tiles: SvgTile[] = [];

    fetchedTiles: PngTile[] = [];
    fetchingTiles: string[] = [];

    constructor(private db: DbService) { }


    addToRoom(roomName: string, x: number, y: number): void {
      //  const room = this.rooms.find(r => r.name === roomName);
      //  if (room) {
            //room.tiles.push({x, y});

      //  } else {
            /*this.rooms.push({
                name: roomName, 
                tiles: [{x, y}],
                placedTiles: [],
                placedInteriorTiles: [],
            });*/
       // }
    }

    redrawTiles() {
        console.log('redrawTiles()');
        this.tiles = [];
        this.roomTiles.forEach((tile: SvgTile) => {
          this.placeTile_old(tile.x, tile.y, tile.name, tile.layer);
        });
    
        this.userTiles.forEach((tile: SvgTile) => {
          this.placeTile_old(tile.x, tile.y, tile.name, tile.layer);
        });
    }

    placeTile2(tile: SvgTile, isRoom: boolean)
  {
      if(isRoom)
      {
        //check if roomTiles contains tile
        if(this.roomTiles.some((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer;}))
        {
          const roomTile = this.roomTiles.find((roomTile: SvgTile) => {return roomTile.x === tile.x && roomTile.y === tile.y && roomTile.layer === tile.layer;});
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
   }
}