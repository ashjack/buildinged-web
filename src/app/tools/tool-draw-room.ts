import { SvgTile } from "../models/app.models";
import { BuildingService } from "../services/building.service";
import { GridService } from "../services/grid.service";
import { RoomService } from "../services/room.service";
import ToolDraw from "./tool-draw";
import * as fromRoot from '../app.reducers';
import { Store } from "@ngrx/store";
import { AddRoom, EditRooms } from "../app.actions";

export default class ToolDrawRoom extends ToolDraw {

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
        const building = this.buildingService.building;
        if (!building) return;
        const index = building.rooms.indexOf(this.roomService.selectedRoom!);
        if (!remove && index < 0) return;
        this.store.dispatch(new AddRoom(i, j, level, remove ? 0 : index + 1));
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
        this.startGesture(x, y, this.gridService.getSelectedLevel());
    }

    override endDrag(x: number, y: number): void {
        const start = this.finishGesture(this.gridService.getSelectedLevel());
        if (!start) return;
        const { x: startX, y: startY } = start;
        const building = this.buildingService.building;
        if (!building) return;
        const index = building.rooms.indexOf(this.roomService.selectedRoom!);
        if (this.key !== 'Control' && index < 0) return;
        this.store.dispatch(new EditRooms({
            x: Math.min(startX, x), y: Math.min(startY, y),
            width: Math.abs(x - startX) + 1, height: Math.abs(y - startY) + 1,
        }, this.gridService.getSelectedLevel(), this.key === 'Control' ? 0 : index + 1));
    }

    override clickTile(x: number, y: number): void {
        this.beginDrag(x, y); this.endDrag(x, y);
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
