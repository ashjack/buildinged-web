import { Injectable } from "@angular/core";
import { Building, GridRoom, GridTile, Room, SvgTile, Tile } from "../models/app.models";
import { GridService } from "./grid.service";
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';

@Injectable({
    providedIn: 'root',
  })
export class RoomService {
    building: Building | undefined;
    rooms: GridRoom[] = [];
    selectedRoom: Room | null = null;

    constructor(private gridService: GridService, private store: Store<fromRoot.State>,) { 
        
    }

    wallTiles: string[] = [
        'walls_exterior_house_01_000.png', //left facing
        'walls_exterior_house_01_001.png', //right facing
        'walls_exterior_house_01_002.png', //joint corner
        'walls_exterior_house_01_003.png', //edge corner (small)
        'walls_exterior_house_01_004.png',
        'walls_exterior_house_01_005.png',
        'walls_exterior_house_01_006.png',
        'walls_exterior_house_01_007.png',
    ]

    floorTile = 'floors_interior_tilesandwood_01_019.png';

    getRoomFromTile(x: number, y: number, level: number): GridRoom | null
    {
        let room: GridRoom | null = null;

        this.rooms.forEach((r: GridRoom) => {
            if(r.tiles.some((tile: GridTile) => {return tile.x === x && tile.y === y && tile.level === level;}))
            {
                room = r;
            }
        });

        return room;
    }

    getRoomFromName(name: string): GridRoom | null
    {
        let room: GridRoom | null = null;

        this.rooms.forEach((r: GridRoom) => {
            if(r.name === name)
            {
                room = r;
            }
        });

        return room;
    }

    verifyRoomTiles() 
    {
        this.store.select(fromRoot.getBuilding).subscribe(b => {
            this.building = b;
        });

        if(this.building == undefined)
        {
            return;
        }

        let building: Building = this.building;

        

        this.rooms.forEach((room) => {

            room.placedTiles = [];
            room.placedInteriorTiles = [];

            const interiorWallTiles = building.entries[room.room.InteriorWall - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            const exteriorWallTiles = building.entries[building.ExteriorWall - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            const floorTile = building.entries[room.room.Floor - 1]?.tiles[0].tile + '.png';
            const grimeFloor = building.entries[room.room.GrimeFloor - 1]?.tiles[0].tile + '.png';
            const grimeWallTiles = building.entries[room.room.GrimeWall - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            const interiorWallTrim = building.entries[room.room.InteriorWallTrim - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            
            const topTiles: GridTile[] = [];
            const bottomTiles: GridTile[] = [];
            const leftTiles: GridTile[] = [];
            const rightTiles: GridTile[] = [];
            const cornerTiles: GridTile[] = [];
            const smallCornerTiles: GridTile[] = [];

            room.tiles.forEach((tile) => {
                const aboveTile: GridTile = {x: tile.x, y: tile.y - 1, level: tile.level};
                const belowTile: GridTile = {x: tile.x, y: tile.y + 1, level: tile.level};
                const leftTile: GridTile = {x: tile.x - 1, y: tile.y, level: tile.level};
                const rightTile: GridTile = {x: tile.x + 1, y: tile.y, level: tile.level};

                //Place Floor Tile
                if(!this.gridService.tileExists(tile.x, tile.y, tile.level, 'Floor'))
                {
                    this.placeFloorTile(room, tile.x, tile.y, tile.level, floorTile);
                }

                //Place Wall Tiles

                //Top
                if(!this.getInRoom(room, aboveTile.x, aboveTile.y, aboveTile.level))
                {
                    if(!this.getInRoom(room, leftTile.x, leftTile.y, leftTile.level))
                    {
                        cornerTiles.push(tile);
                        this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[2], true);
                        if(interiorWallTrim)
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTrim[2], true, "WallTrim");
                    }
                    else
                    {
                        topTiles.push(tile);
                        console.log(this.gridService.objects)
                        if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Door'))
                        {
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[7], true);
                        }
                        else if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Window'))
                        {
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[5], true);
                            if(interiorWallTrim)
                                this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTrim[1], true, "WallTrim");
                        }
                        else
                        {
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[1], true);
                            if(interiorWallTrim)
                                this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTrim[1], true, "WallTrim");
                        }
                    }
                }
                //Bottom
                if(!this.getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                {
                    if(this.getInAnyRoom(leftTile.x, belowTile.y, belowTile.level))
                    {
                        cornerTiles.push(tile);
                        this.placeTile(room, tile.x, tile.y + 1, tile.level, exteriorWallTiles[2]);
                    }

                    else
                    {
                        bottomTiles.push(tile);
                        if(this.gridService.getObjectAt(tile.x, tile.y + 1, tile.level, 'Door'))
                        {
                            this.placeTile(room, tile.x, tile.y + 1, tile.level, exteriorWallTiles[7]);
                        }
                        else if(this.gridService.getObjectAt(tile.x, tile.y + 1, tile.level, 'Window'))
                        {
                            this.placeTile(room, tile.x, tile.y + 1, tile.level, exteriorWallTiles[5]);
                        }
                        else
                        {
                            this.placeTile(room, tile.x, tile.y + 1, tile.level, exteriorWallTiles[1]);
                        }
                        //placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[1]);
                    }
                }
                //Left
                if(!this.getInRoom(room, leftTile.x, leftTile.y, leftTile.level))
                {
                    if(!this.getInRoom(room, aboveTile.x, aboveTile.y, aboveTile.level))
                    {
                        cornerTiles.push(tile);
                        this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[2], true);
                        if(interiorWallTrim)
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTrim[2], true, "WallTrim");
                    }
                    else
                    {
                        leftTiles.push(tile);
                        if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Door'))
                        {
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[6], true);
                        }
                        else if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Window'))
                        {
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[4], true);
                            if(interiorWallTrim)
                                this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTrim[0], true, "WallTrim");
                        }
                        else
                        {
                            this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[0], true);
                            if(interiorWallTrim)
                                this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTrim[0], true, "WallTrim");
                        }
                        //placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[0], true);
                    }
                }
                //Right
                if(!this.getInAnyRoom(rightTile.x, rightTile.y, rightTile.level))
                {
                    if(!this.getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                    {
                        smallCornerTiles.push(tile);
                        this.placeTile(room, tile.x + 1, tile.y + 1, tile.level, exteriorWallTiles[3]);
                    }

                    rightTiles.push(tile);
                    if(this.gridService.getObjectAt(tile.x + 1, tile.y, tile.level, 'Door'))
                    {
                        this.placeTile(room, tile.x + 1, tile.y, tile.level, exteriorWallTiles[6]);
                    }
                    else if(this.gridService.getObjectAt(tile.x + 1, tile.y, tile.level, 'Window'))
                    {
                        this.placeTile(room, tile.x + 1, tile.y, tile.level, exteriorWallTiles[4]);
                    }
                    else
                    {
                        this.placeTile(room, tile.x + 1, tile.y, tile.level, exteriorWallTiles[0]);
                    }
                    //placeTile(tile.x + 1, tile.y, tile.level, this.exteriorWallTiles[0]);
                    
                }
            })

        //Place Corners
        room.tiles.forEach((tile: GridTile) => {
            const aboveTile: GridTile = {x: tile.x, y: tile.y - 1, level: tile.level};
            const belowTile: GridTile = {x: tile.x, y: tile.y + 1, level: tile.level};
            const leftTile: GridTile = {x: tile.x - 1, y: tile.y, level: tile.level};
            const rightTile: GridTile = {x: tile.x + 1, y: tile.y, level: tile.level};

            //Place Corners
            //Top
            if(!this.getInRoom(room, aboveTile.x, aboveTile.y, aboveTile.level))
            {
                if(!this.getInRoom(room, leftTile.x, leftTile.y, leftTile.level))
                {
                    cornerTiles.push(tile);
                    this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[2], true);
                }
            }
            //Bottom
            if(!this.getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
            {
                if(this.getInAnyRoom(leftTile.x, belowTile.y, belowTile.level))
                {
                    cornerTiles.push(tile);
                    this.placeTile(room, tile.x , tile.y + 1, tile.level, exteriorWallTiles[2]);
                }
            }
            //Left
            if(!this.getInRoom(room, leftTile.x, leftTile.y, leftTile.level))
            {
                if(!this.getInRoom(room, aboveTile.x, aboveTile.y, aboveTile.level))
                {
                    cornerTiles.push(tile);
                    this.placeTile(room, tile.x, tile.y, tile.level, interiorWallTiles[2], true);
                }

                if(this.getInRoom(room, leftTile.x, belowTile.y, belowTile.level))
                {
                    if(!this.getInRoom(room, leftTile.x, leftTile.y, leftTile.level) && !this.getInRoom(room, belowTile.x, belowTile.y, belowTile.level))
                    {
                        if(!this.getInAnyRoom(leftTile.x, leftTile.y, leftTile.level) && !this.getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                        {
                            cornerTiles.push(tile);
                            this.placeTile(room, tile.x, tile.y + 1, tile.level, exteriorWallTiles[2]);
                        }
                    }
                    else
                    {
                        smallCornerTiles.push(tile);
                        this.placeTile(room, tile.x, tile.y + 1, tile.level, interiorWallTiles[3], true);
                    }
                }
            }
            //Right
            if(!this.getInAnyRoom(rightTile.x, rightTile.y, rightTile.level))
            {
                if(!this.getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                {
                    if(cornerTiles.some((cornerTile: GridTile) => {return cornerTile.x === tile.x + 1 && cornerTile.y === tile.y + 1;}))
                    {
                        
                    }
                    else
                    {
                        if(!this.getInAnyRoom(rightTile.x, rightTile.y, rightTile.level) && !this.getInAnyRoom(rightTile.x, belowTile.y, belowTile.level))
                        {
                            smallCornerTiles.push(tile);
                            this.placeTile(room, tile.x + 1, tile.y + 1, tile.level, exteriorWallTiles[3]);
                        }
                        else if(this.getInAnyRoom(leftTile.x, leftTile.y, leftTile.level))
                        {
                            cornerTiles.push(tile);
                            this.placeTile(room, tile.x + 1, tile.y, tile.level, exteriorWallTiles[2]);
                        }
                    }
                }
                
            }
        });

        this.gridService.redrawTiles();
        })
    }

    placeTile(room: GridRoom, x: number, y: number, level: number, url: string, interior: boolean = false, layer: string = 'Walls')
    {
        if(room.placedTiles.some(tl => tl.x == x && tl.y == y && tl.level == level && tl.layer == layer && tl.url == url))
        {
            return;
        }

        const tile: SvgTile = {
            name: url,
            url: url,
            x: x,
            y: y,
            layer: layer,
            level: level,
            auto: true
        };
        this.gridService.placeTile2(tile, true);
        room.placedTiles.push({name: url, url: '', x: x, y: y, level: level, layer: layer});
        if(interior)
        {
            room.placedInteriorTiles.push({name: url, url: '', x: x, y: y, level: level, layer: layer});
        }
    }

    placeFloorTile(room: GridRoom, x: number, y: number, level: number, url: string) 
    {
        const tile: SvgTile = {
            name: url,
            url: url,
            x: x,
            y: y,
            layer: 'Floor',
            level: level,
            auto: true
        };

        //console.log("Placing floor tile " + url + " at " + x + "," + y + "," + level)

        this.gridService.placeTile2(tile, true);
        room.placedTiles.push({name: url, url: '', x: x, y: y, level: level, layer: 'Floor'});
        room.placedInteriorTiles.push({name: url, url: '', x: x, y: y, level: level, layer: 'Floor'});
    }

    private getInRoom(room: GridRoom, x: number, y: number, level: number): boolean {
        return room.tiles.some((tile: GridTile) => {return tile.x === x && tile.y === y && tile.level === level;});
    }

    private getInAnyRoom(x: number, y: number, level: number): boolean {
        return this.rooms.some((room: GridRoom) => {
            return room.tiles.some((tile: GridTile) => {
                return tile.x === x && tile.y === y && tile.level === level;
            });
        });
    }
}