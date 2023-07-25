import { GridRoom, GridTile, SvgTile } from "../models/app.models";
import { ViewportComponent } from "../viewport/viewport.component";
import ToolDraw from "./tool-draw";

export default class ToolDrawRoom extends ToolDraw {

    selectedRoom: string = 'livingroom';
    wallTiles: string[] = [
        'tile_0.png', //left facing
        'tile_1.png', //right facing
        'tile_2.png', //joint corner
        'tile_3.png', //edge corner (small)
        'tile_4.png',
        'tile_5.png',
        'tile_6.png',
        'tile_7.png',
    ]
    
    constructor(grid: ViewportComponent) {
        super(grid);
    }

    setRoom(i: number, j: number, remove: boolean): void
    {
        //Set room
        if(remove)
        {
            this.grid.rooms.forEach((room: GridRoom) => {
                if(room.name === this.selectedRoom)
                {
                    room.tiles.forEach((tile: GridTile, index: number) => {
                        if(tile.x === i && tile.y === j)
                        {
                            room.tiles.splice(index, 1);
                        }
                    });
                }
            });

            return;
        }
        if(this.grid.rooms.some((room: GridRoom) => {return room.name === this.selectedRoom;}))
        {
            this.grid.rooms.forEach((room: GridRoom) => {
                if(room.name === this.selectedRoom)
                {
                    if(!room.tiles.some((tile: GridTile) => {return tile.x === i && tile.y === j;}))
                    {
                        room.tiles.push({x: i, y: j});
                    }
                    //room.tiles = this.dragTiles;
                }
            });
        }
        else
        {
            this.grid.rooms.push({
                name: this.selectedRoom,
                tiles: [{x: i, y: j}],
                placedTiles: [],
                placedInteriorTiles: []
            });
        }

        console.log(this.grid.rooms);
    }

    drawRoom(room: GridRoom): void
    {
        //Clear room tiles
        this.grid.roomTiles = [];
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

        const placeTile = (x: number, y: number, url: string, interior: boolean = false) => {
            const tile: SvgTile = {
                name: url,
                url: url,
                x: x,
                y: y,
                layer: 'Walls'
            };
            this.grid.placeTile2(tile, true);
            room.placedTiles.push({name: url, url: '', x: x, y: y, layer: 'Walls'});
            if(interior)
            {
                room.placedInteriorTiles.push({name: url, url: '', x: x, y: y, layer: 'Walls'});
            }
        }

        const getInRoom = (x: number, y: number): boolean => {
            return room.tiles.some((tile: GridTile) => {return tile.x === x && tile.y === y;});
        }


        room.tiles.forEach((tile: GridTile) => {
            //if the tile is on the outside of the room, draw a wall
            //if the tile is on the inside of the room, draw a floor
            const aboveTile: GridTile = {x: tile.x, y: tile.y - 1};
            const belowTile: GridTile = {x: tile.x, y: tile.y + 1};
            const leftTile: GridTile = {x: tile.x - 1, y: tile.y};
            const rightTile: GridTile = {x: tile.x + 1, y: tile.y};

            //Place Tiles
            //Top
            if(!getInRoom(aboveTile.x, aboveTile.y))
            {
                if(!room.tiles.some((roomTile: GridTile) => {return roomTile.x === leftTile.x && roomTile.y === leftTile.y;}))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, this.wallTiles[2+4], true);
                }
                else
                {
                    topTiles.push(tile);
                    placeTile(tile.x, tile.y, this.wallTiles[1+4], true);
                }
            }
            //Bottom
            if(!getInRoom(belowTile.x, belowTile.y))
            {
                if(getInRoom(leftTile.x, belowTile.y))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x , tile.y + 1, this.wallTiles[2]);
                }

                else
                {
                bottomTiles.push(tile);
                placeTile(tile.x, tile.y + 1, this.wallTiles[1]);
                }
            }
            //Left
            if(!getInRoom(leftTile.x, leftTile.y))
            {
                if(!room.tiles.some((roomTile: GridTile) => {return roomTile.x === aboveTile.x && roomTile.y === aboveTile.y;}))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, this.wallTiles[2+4], true);
                }
                else
                {
                    leftTiles.push(tile);
                    placeTile(tile.x, tile.y, this.wallTiles[0+4], true);
                }
            }
            //Right
            if(!getInRoom(rightTile.x, rightTile.y))
            {
                if(!room.tiles.some((roomTile: GridTile) => {return roomTile.x === belowTile.x && roomTile.y === belowTile.y;}))
                {
                    smallCornerTiles.push(tile);
                    placeTile(tile.x + 1, tile.y + 1, this.wallTiles[3]);
                }

                rightTiles.push(tile);
                placeTile(tile.x + 1, tile.y, this.wallTiles[0]);
                
            }
        });

        //Place Corners
        room.tiles.forEach((tile: GridTile) => {
            const aboveTile: GridTile = {x: tile.x, y: tile.y - 1};
            const belowTile: GridTile = {x: tile.x, y: tile.y + 1};
            const leftTile: GridTile = {x: tile.x - 1, y: tile.y};
            const rightTile: GridTile = {x: tile.x + 1, y: tile.y};

            //Place Corners
            //Top
            if(!getInRoom(aboveTile.x, aboveTile.y))
            {
                if(!room.tiles.some((roomTile: GridTile) => {return roomTile.x === leftTile.x && roomTile.y === leftTile.y;}))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, this.wallTiles[2+4], true);
                }
            }
            //Bottom
            if(!getInRoom(belowTile.x, belowTile.y))
            {
                if(getInRoom(leftTile.x, belowTile.y))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x , tile.y + 1, this.wallTiles[2]);
                }
            }
            //Left
            if(!getInRoom(leftTile.x, leftTile.y))
            {
                if(!room.tiles.some((roomTile: GridTile) => {return roomTile.x === aboveTile.x && roomTile.y === aboveTile.y;}))
                {
                    cornerTiles.push(tile);
                    placeTile(tile.x, tile.y, this.wallTiles[2+4], true);
                }

                if(getInRoom(leftTile.x, belowTile.y))
                {
                    if(!getInRoom(leftTile.x, leftTile.y) && !getInRoom(belowTile.x, belowTile.y))
                    {
                        cornerTiles.push(tile);
                        placeTile(tile.x, tile.y + 1, this.wallTiles[2]);
                    }
                    else
                    {
                    smallCornerTiles.push(tile);
                    placeTile(tile.x, tile.y + 1, this.wallTiles[3+4], true);
                    }
                }
            }
            //Right
            if(!getInRoom(rightTile.x, rightTile.y))
            {
                if(!room.tiles.some((roomTile: GridTile) => {return roomTile.x === belowTile.x && roomTile.y === belowTile.y;}))
                {
                    if(cornerTiles.some((cornerTile: GridTile) => {return cornerTile.x === tile.x + 1 && cornerTile.y === tile.y + 1;}))
                    {

                    }
                    else
                    {
                        smallCornerTiles.push(tile);
                        placeTile(tile.x + 1, tile.y + 1, this.wallTiles[3]);
                    }
                }
                
            }
        });

        console.log(topTiles);

        this.grid.redrawTiles();
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
                layer: 'Walls'
              };
              this.dragTiles.push(tile);
            }
          }
        }
        else
        {
            this.dragTiles = [];
            this.dragTiles.push({name: '', url: '', x: x, y: y, layer: 'Walls'});
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
                this.setRoom(i,j, this.key === 'Control');
            }
        }

        //Draw room
        this.drawRoom(this.grid.rooms[this.grid.rooms.length - 1]);
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
          return 'red';
        }
        
        return '#34343400'
    }

}