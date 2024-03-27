import { GridRoom, GridTile, Room, SvgTile, Tile } from "../models/app.models";
import { BuildingService } from "../services/building.service";
import { GridService } from "../services/grid.service";
import { RoomService } from "../services/room.service";
import ToolDraw from "./tool-draw";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { AddRoom } from "../app.actions";

export default class ToolDrawRoom extends ToolDraw {

    //selectedRoom: string = 'livingroom';
    //selectedRoomObject: Room;
    // wallTiles: string[] = [
    //     'walls_exterior_house_01_000.png', //left facing
    //     'walls_exterior_house_01_001.png', //right facing
    //     'walls_exterior_house_01_002.png', //joint corner
    //     'walls_exterior_house_01_003.png', //edge corner (small)
    //     'walls_exterior_house_01_004.png',
    //     'walls_exterior_house_01_005.png',
    //     'walls_exterior_house_01_006.png',
    //     'walls_exterior_house_01_007.png',
    // ]

    interiorWallTiles: string[] = [
        'walls_interior_house_01_000.png', //left facing
        'walls_interior_house_01_001.png', //right facing
        'walls_interior_house_01_002.png', //joint corner
        'walls_interior_house_01_003.png', //edge corner (small)
    ];
    exteriorWallTiles: string[] = [
        'walls_exterior_house_01_000.png', //left facing
        'walls_exterior_house_01_001.png', //right facing
        'walls_exterior_house_01_002.png', //joint corner
        'walls_exterior_house_01_003.png', //edge corner (small)
    ];

    floorTile = 'floors_interior_tilesandwood_01_019.png';
    grimeFloor = '';
    grimeWallTiles: string[] = [];
    interiorWallTrim: string[] = [];
    
    constructor(
        private roomService: RoomService,
        private gridService: GridService,
        private buildingService: BuildingService,
        private store: Store<fromRoot.State>,) {
        super();

        //this.selectedRoomObject = this.roomService.getRoomFromName(this.selectedRoom);
    }

    setRoom(i: number, j: number, level: number, remove: boolean): void
    {
        //Set room
        if(remove)
        {
            this.roomService.rooms.forEach((room: GridRoom) => {
                room.tiles.forEach((tile: GridTile, index: number) => {
                    if(tile.x === i && tile.y === j && tile.level === level)
                    {
                        room.tiles.splice(index, 1);
                    }
                });
            });

            this.store.dispatch(new AddRoom(i, j, level, 0))

            return;
        }
        
        //If room at this location already exists and is not the selected room, remove the tile from that room
        this.roomService.rooms.forEach((room: GridRoom) => {
            if(room.name !== this.roomService.selectedRoom?.Name)
            {
                room.tiles.forEach((tile: GridTile, index: number) => {
                    if(tile.x === i && tile.y === j && tile.level == level)
                    {
                        room.tiles.splice(index, 1);
                    }
                });
            }
        });

        if(this.roomService.rooms.some((room: GridRoom) => {return room.name === this.roomService.selectedRoom?.Name;}))
        {
            this.roomService.rooms.forEach((room: GridRoom) => {
                if(room.name === this.roomService.selectedRoom?.Name)
                {
                    if(!room.tiles.some((tile: GridTile) => {return tile.x === i && tile.y === j && tile.level === level;}))
                    {
                        room.tiles.push({x: i, y: j, level: level});
                    }
                    //room.tiles = this.dragTiles;
                }
            });
        }
        else
        {
            this.roomService.rooms.push({
                name: this.roomService.selectedRoom!.Name,
                room: this.roomService.selectedRoom!,
                tiles: [{x: i, y: j, level: level}],
                placedTiles: [],
                placedInteriorTiles: []
            });
        }

        const roomName = this.roomService.rooms.findIndex(x => x.name == this.roomService.selectedRoom?.Name);

        this.store.dispatch(new AddRoom(i, j, level, roomName + 1))
        console.log(i, j, level, roomName  + 1)

    }

    drawRooms(): void
    {
        this.gridService.roomTiles = this.gridService.roomTiles.filter(tile => !tile.auto)
        console.log(this.roomService.rooms)
        this.roomService.rooms.forEach((room: GridRoom) => {
            this.drawRoom(room);
        });
    }

    private drawRoom(room: GridRoom): void
    {
        //Get room object from RoomService
        const roomObject = this.buildingService.building.rooms.find((ro: Room) => {return ro.Name === room.name;});

        if(roomObject)
        {
            //console.log(this.buildingService.building.entries[roomObject.InteriorWall - 1])
            this.interiorWallTiles = this.buildingService.building.entries[roomObject.InteriorWall - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            this.exteriorWallTiles = this.buildingService.building.entries[this.buildingService.building.ExteriorWall - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            this.floorTile = this.buildingService.building.entries[roomObject.Floor - 1]?.tiles[0].tile + '.png';
            this.grimeFloor = this.buildingService.building.entries[roomObject.GrimeFloor - 1]?.tiles[0].tile + '.png';
            this.grimeWallTiles = this.buildingService.building.entries[roomObject.GrimeWall - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            this.interiorWallTrim = this.buildingService.building.entries[roomObject.InteriorWallTrim - 1]?.tiles.map((tile: Tile) => {return tile.tile + '.png';});
            
           //console.log(this.interiorWallTiles);
        }

        //Clear room tiles
        //this.gridService.roomTiles = [];
        room.placedInteriorTiles = [];
        room.placedTiles = [];
       // room.placedTiles.forEach((tile: SvgTile) => {
       //     this.grid.removeTile(tile.x, tile.y);
      //  });

        //Draw room
        const topTiles: GridTile[] = [];
        const bottomTiles: GridTile[] = [];
        const leftTiles: GridTile[] = [];
        const rightTiles: GridTile[] = [];
        const cornerTiles: GridTile[] = [];
        const smallCornerTiles: GridTile[] = [];

        const placeTile = (x: number, y: number, level: number, url: string, interior: boolean = false, layer: string = 'Walls') => {
            this.roomService.placeTile(room, x, y, level, url, interior, layer);
            // const tile: SvgTile = {
            //     name: url,
            //     url: url,
            //     x: x,
            //     y: y,
            //     layer: layer,
            //     level: level,
            //     auto: true
            // };
            // this.gridService.placeTile2(tile, true);
            // room.placedTiles.push({name: url, url: '', x: x, y: y, level: level, layer: layer});
            // if(interior)
            // {
            //     room.placedInteriorTiles.push({name: url, url: '', x: x, y: y, level: level, layer: layer});
            // }
        }

        const placeFloorTile = (x: number, y: number, level: number, url: string) => {
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

        const getInRoom = (x: number, y: number, level: number): boolean => {
            return room.tiles.some((tile: GridTile) => {return tile.x === x && tile.y === y && tile.level === level;});
            // return this.roomService.rooms.some((room: GridRoom) => {
            //     return room.tiles.some((tile: GridTile) => {
            //         return tile.x === x && tile.y === y;
            //     });
            // });
        }

        const getInAnyRoom = (x: number, y: number, level: number): boolean => {
            return this.roomService.rooms.some((room: GridRoom) => {
                return room.tiles.some((tile: GridTile) => {
                    return tile.x === x && tile.y === y && tile.level === level;
                });
            });
        }


        room.tiles.forEach((tile: GridTile) => {
            //if the tile is on the outside of the room, draw a wall
            //if the tile is on the inside of the room, draw a floor
            const aboveTile: GridTile = {x: tile.x, y: tile.y - 1, level: tile.level};
            const belowTile: GridTile = {x: tile.x, y: tile.y + 1, level: tile.level};
            const leftTile: GridTile = {x: tile.x - 1, y: tile.y, level: tile.level};
            const rightTile: GridTile = {x: tile.x + 1, y: tile.y, level: tile.level};

            //Place Floor Tiles
            placeFloorTile(tile.x, tile.y, tile.level, this.floorTile);

            //Place Wall Tiles
            //Top
            if(!getInRoom(aboveTile.x, aboveTile.y, aboveTile.level))
            {
                if(!getInRoom(leftTile.x, leftTile.y, leftTile.level))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[2], true);
                    if(this.interiorWallTrim)
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[2], true, "WallTrim");
                }
                else
                {
                    topTiles.push(tile);
                    if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Door'))
                    {
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[7], true);
                        if(this.interiorWallTrim)
                            placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[7], true, "WallTrim");
                    }
                    else if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Window'))
                    {
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[5], true);
                        if(this.interiorWallTrim)
                            placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[1], true, "WallTrim");
                    }
                    else
                    {
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[1], true);
                        if(this.interiorWallTrim)
                            placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[1], true, "WallTrim");
                    }
                }
            }
            //Bottom
            if(!getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
            {
                if(getInAnyRoom(leftTile.x, belowTile.y, belowTile.level))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[2]);
                }

                else
                {
                    bottomTiles.push(tile);
                    if(this.gridService.getObjectAt(tile.x, tile.y + 1, tile.level, 'Door'))
                    {
                        placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[7]);
                    }
                    else if(this.gridService.getObjectAt(tile.x, tile.y + 1, tile.level, 'Window'))
                    {
                        placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[5]);
                    }
                    else
                    {
                        placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[1]);
                    }
                    //placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[1]);
                }
            }
            //Left
            if(!getInRoom(leftTile.x, leftTile.y, leftTile.level))
            {
                if(!getInRoom(aboveTile.x, aboveTile.y, aboveTile.level))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[2], true);
                    if(this.interiorWallTrim)
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[2], true, "WallTrim");
                }
                else
                {
                    leftTiles.push(tile);
                    if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Door'))
                    {
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[6], true);
                        if(this.interiorWallTrim)
                            placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[6], true, "WallTrim");
                    }
                    else if(this.gridService.getObjectAt(tile.x, tile.y, tile.level, 'Window'))
                    {
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[4], true);
                        if(this.interiorWallTrim)
                            placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[4], true, "WallTrim");
                    }
                    else
                    {
                        placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[0], true);
                        if(this.interiorWallTrim)
                            placeTile(tile.x, tile.y, tile.level, this.interiorWallTrim[0], true, "WallTrim");
                    }
                    //placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[0], true);
                }
            }
            //Right
            if(!getInAnyRoom(rightTile.x, rightTile.y, rightTile.level))
            {
                if(!getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                {
                    smallCornerTiles.push(tile);
                    placeTile(tile.x + 1, tile.y + 1, tile.level, this.exteriorWallTiles[3]);
                }

                rightTiles.push(tile);
                if(this.gridService.getObjectAt(tile.x + 1, tile.y, tile.level, 'Door'))
                {
                    placeTile(tile.x + 1, tile.y, tile.level, this.exteriorWallTiles[6]);
                }
                else if(this.gridService.getObjectAt(tile.x + 1, tile.y, tile.level, 'Window'))
                {
                    placeTile(tile.x + 1, tile.y, tile.level, this.exteriorWallTiles[4]);
                }
                else
                {
                    placeTile(tile.x + 1, tile.y, tile.level, this.exteriorWallTiles[0]);
                }
                //placeTile(tile.x + 1, tile.y, tile.level, this.exteriorWallTiles[0]);
                
            }
        });

        //Place Corners
        room.tiles.forEach((tile: GridTile) => {
            const aboveTile: GridTile = {x: tile.x, y: tile.y - 1, level: tile.level};
            const belowTile: GridTile = {x: tile.x, y: tile.y + 1, level: tile.level};
            const leftTile: GridTile = {x: tile.x - 1, y: tile.y, level: tile.level};
            const rightTile: GridTile = {x: tile.x + 1, y: tile.y, level: tile.level};

            //Place Corners
            //Top
            if(!getInRoom(aboveTile.x, aboveTile.y, aboveTile.level))
            {
                if(!getInRoom(leftTile.x, leftTile.y, leftTile.level))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[2], true);
                }
            }
            //Bottom
            if(!getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
            {
                if(getInAnyRoom(leftTile.x, belowTile.y, belowTile.level))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x , tile.y + 1, tile.level, this.exteriorWallTiles[2]);
                }
            }
            //Left
            if(!getInRoom(leftTile.x, leftTile.y, leftTile.level))
            {
                if(!getInRoom(aboveTile.x, aboveTile.y, aboveTile.level))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, tile.level, this.interiorWallTiles[2], true);
                }

                if(getInRoom(leftTile.x, belowTile.y, belowTile.level))
                {
                    if(!getInRoom(leftTile.x, leftTile.y, leftTile.level) && !getInRoom(belowTile.x, belowTile.y, belowTile.level))
                    {
                        if(!getInAnyRoom(leftTile.x, leftTile.y, leftTile.level) && !getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                        {
                            cornerTiles.push(tile);
                            placeTile(tile.x, tile.y + 1, tile.level, this.exteriorWallTiles[2]);
                        }
                    }
                    else
                    {
                        smallCornerTiles.push(tile);
                        placeTile(tile.x, tile.y + 1, tile.level, this.interiorWallTiles[3], true);
                    }
                }
            }
            //Right
            if(!getInAnyRoom(rightTile.x, rightTile.y, rightTile.level))
            {
                if(!getInAnyRoom(belowTile.x, belowTile.y, belowTile.level))
                {
                    if(cornerTiles.some((cornerTile: GridTile) => {return cornerTile.x === tile.x + 1 && cornerTile.y === tile.y + 1;}))
                    {
                        
                    }
                    else
                    {
                        if(!getInAnyRoom(rightTile.x, rightTile.y, rightTile.level) && !getInAnyRoom(rightTile.x, belowTile.y, belowTile.level))
                        {
                            smallCornerTiles.push(tile);
                            placeTile(tile.x + 1, tile.y + 1, tile.level, this.exteriorWallTiles[3]);
                        }
                        else if(getInAnyRoom(leftTile.x, leftTile.y, leftTile.level))
                        {
                            cornerTiles.push(tile);
                            placeTile(tile.x + 1, tile.y, tile.level, this.exteriorWallTiles[2]);
                        }
                    }
                }
                
            }
        });

        this.gridService.redrawTiles();
    }

    override hoverTile(x: number, y: number): void {

        if(this.isDragging)
        {
          this.dragTiles = [];
          const x1 = this.beginDragCoords[0];
          const y1 = this.beginDragCoords[1];
          const x2 = x;
          const y2 = y;
          const xMin = Math.min(x1, x2);
          const xMax = Math.max(x1, x2);
          const yMin = Math.min(y1, y2);
          const yMax = Math.max(y1, y2);
          for(let i = xMin; i <= xMax; i++)
          {
            for(let j = yMin; j <= yMax; j++)
            {
              const tile: SvgTile = {
                name: '',
                url: '',
                x: i,
                y: j, 
                layer: 'Walls',
                level: this.gridService.getSelectedLevel()
              };
              this.dragTiles.push(tile);
            }
          }
        }
        else
        {
            this.dragTiles = [];
            this.dragTiles.push({name: '', url: '', x: x, y: y, level: this.gridService.getSelectedLevel(), layer: 'Walls'});
        }
    }

    override beginDrag(x: number, y: number): void {
        this.beginDragCoords = [x, y];
        this.isDragging = true;
    }

    override endDrag(x: number, y: number): void {
        this.isDragging = false;
        this.dragTiles = [];
        const x1 = this.beginDragCoords[0];
        const y1 = this.beginDragCoords[1];
        const x2 = x;
        const y2 = y;
        const xMin = Math.min(x1, x2);
        const xMax = Math.max(x1, x2);
        const yMin = Math.min(y1, y2);
        const yMax = Math.max(y1, y2);
        for(let i = xMin; i <= xMax; i++)
        {
            for(let j = yMin; j <= yMax; j++)
            {
                //Set room
                this.setRoom(i,j, this.gridService.getSelectedLevel(), this.key === 'Control');
            }
        }

        //Draw room
        //this.drawRoom(this.roomService.rooms[this.roomService.rooms.length - 1]);
        this.drawRooms();
        //this.roomService.verifyRoomTiles();
    }

    override clickTile(x: number, y: number): void {
        
    }
    override getTileFill(x: number, y: number): string {
        if(this.dragTiles.some((tile: SvgTile) => {return tile.x === x && tile.y === y;}))
        {
            if(this.key === 'Control')
            {
                return '#00000070';
            }
            
            return 'rgb(' + this.roomService.selectedRoom?.Color + ')'
          return 'red';
        }
        
        return '#34343400'
    }

}