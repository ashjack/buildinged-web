import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';
import { Building, GridRoom, Room, SvgTile } from '../models/app.models';
import * as fromRoot from '../app.reducers';
import { GridService } from './grid.service';
import { readIndexGrid } from '../utils/tbx-grid';

@Injectable({ providedIn: 'root' })
export class RoomService {
    // Rendering data only. Membership is rebuilt from the document's room grids.
    rooms: GridRoom[] = [];
    selectedRoomIndex = 0;

    constructor(private gridService: GridService, private store: Store<fromRoot.State>) { }

    get selectedRoom(): Room | null {
        let building: Building | undefined;
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(value => building = value);
        return building?.rooms[this.selectedRoomIndex] || null;
    }

    set selectedRoom(room: Room | null) {
        let building: Building | undefined;
        this.store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(value => building = value);
        this.selectedRoomIndex = room ? building?.rooms.indexOf(room) ?? -1 : -1;
    }

    rebuild(building?: Building): void {
        this.rooms = building?.rooms.map(room => ({ name: room.Name, room, tiles: [], placedTiles: [], placedInteriorTiles: [] })) || [];
        if (!building) return;
        if (this.selectedRoomIndex < 0 || this.selectedRoomIndex >= building.rooms.length) this.selectedRoomIndex = 0;
        building.floors.forEach((floor, level) => {
            readIndexGrid(floor.rooms, building.width, building.height).forEach((row, y) => row.forEach((index, x) => {
                if (index) this.rooms[index - 1].tiles.push({ x, y, level });
            }));
        });
    }

    getRoomFromTile(x: number, y: number, level: number): GridRoom | null {
        return this.rooms.find(room => room.tiles.some(tile => tile.x === x && tile.y === y && tile.level === level)) || null;
    }

    getRoomFromName(name: string): GridRoom | null {
        return this.rooms.find(room => room.name === name) || null;
    }

    placeTile(room: GridRoom, x: number, y: number, level: number, url: string, interior: boolean = false, layer: string = 'Walls')
    {
        if (!url || url === 'undefined.png') return;
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

}
