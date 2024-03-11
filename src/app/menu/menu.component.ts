import { Component } from '@angular/core';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';
import { SetCurrentTool } from '../app.actions';
import { BuildingService } from '../services/building.service';
import { Room } from '../models/app.models';
import { RoomService } from '../services/room.service';
import { GridService } from '../services/grid.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent {
  constructor(
    private store: Store<fromRoot.State>,
    private buildingService: BuildingService,
    private roomService: RoomService,
    private gridService: GridService
  ) { }

  setTool(tool: string)
  {
    this.store.dispatch(new SetCurrentTool(tool));
  }

  openFileUpload(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    fileInput.click();
  }

  handleFileSelect(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const fileList = inputElement.files;
    console.log(fileList)

    if(!fileList || fileList.length === 0)
    {
      return;
    }

    const file = fileList[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result;
      const constentsString = contents as string;

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(constentsString,"text/xml");
      this.buildingService.createBuildingFromXml(xmlDoc);
      console.log(xmlDoc);
    }
    reader.readAsText(file);

    

  }

  getSelectedRoom(): Room | null {
    return this.roomService.selectedRoom;
  }

  getRooms(): Room[] {
    return this.buildingService.getBuilding().rooms.map(r => r);
  }

  setRoom(room: Room): void {
    this.roomService.selectedRoom = room;
  }

  upFloor(): void {
    this.gridService.setSelectedLevel(this.gridService.getSelectedLevel() + 1);
    console.log("set level to " + this.gridService.getSelectedLevel())
    this.buildingService.drawBuilding();
    this.gridService.showAllTiles();
    this.gridService.redrawTiles();
  }

  downFloor(): void {
    if(this.gridService.getSelectedLevel() > 0)
      this.gridService.setSelectedLevel(this.gridService.getSelectedLevel() - 1);
    console.log("set level to " + this.gridService.getSelectedLevel())
    this.buildingService.drawBuilding();
    this.gridService.showAllTiles();
    this.gridService.redrawTiles();
  }


}
