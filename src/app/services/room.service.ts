import { Injectable } from "@angular/core";
import { GridRoom, GridTile, Room, SvgTile } from "../models/app.models";
import { GridService } from "./grid.service";

@Injectable({
    providedIn: 'root',
  })
export class RoomService {
    rooms: GridRoom[] = [];
    selectedRoom: Room | null = null;

    constructor(private gridService: GridService) { }

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
}