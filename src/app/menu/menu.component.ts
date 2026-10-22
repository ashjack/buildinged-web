import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';
import { ScheduleRedraw, SetCurrentTool, TogglePopup } from '../app.actions';
import { BuildingService } from '../services/building.service';
import { Room } from '../models/app.models';
import { RoomService } from '../services/room.service';
import { GridService } from '../services/grid.service';
import { Undo, Redo, EditFloor } from '../app.actions';
import { RoofService } from '../services/roof.service';
import { RoofOption } from '../services/roof-patterns';
import { ROOF_TOOL_GROUPS, roofOptionIcon, roofToolGroup, RoofToolGroup } from '../utils/roof-toolbar';
import { MAX_BUILDING_FLOORS } from '../utils/floor-edits';
import { historyShortcut } from '../utils/editor-shortcuts';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent {
  @ViewChild('floorsDialog') floorsDialog: ElementRef<HTMLDialogElement>;
  readonly roofGroups = ROOF_TOOL_GROUPS;
  readonly roofIcon = roofOptionIcon;
  readonly maxFloors = MAX_BUILDING_FLOORS;
  openRoofMenu: RoofToolGroup | undefined;
  get selectedRoofGroup() { return roofToolGroup(this.roofs.getSelectedRoofOption()); }
  get floorLevels(): number[] { return (this.buildingService.building?.floors || []).map((_, index) => index).reverse(); }
  get floorCount(): number { return this.buildingService.building?.floors.length || 0; }
  get selectedLevel(): number { return this.gridService.getSelectedLevel(); }
  readonly currentTool$ = this.store.select(fromRoot.getCurrentTool);
  readonly undoLabel$ = this.store.select(fromRoot.getUndoLabel);
  readonly redoLabel$ = this.store.select(fromRoot.getRedoLabel);
  constructor(
    private store: Store<fromRoot.State>,
    private buildingService: BuildingService,
    private roomService: RoomService,
    private gridService: GridService,
    public roofs: RoofService
  ) { }

  setTool(tool: string)
  {
    this.openRoofMenu = undefined;
    this.store.dispatch(new SetCurrentTool(tool));
  }

  @HostListener('document:click') closeRoofMenu(): void { this.openRoofMenu = undefined; }
  @HostListener('document:keydown.escape') escapeMenu(): void { this.closeRoofMenu(); }
  activateRoof(group: RoofToolGroup): void { this.chooseRoof(this.roofs.getGroupOption(group)); }
  chooseRoof(option: RoofOption): void { this.roofs.setSelectedRoofOptionId(option.id); this.setTool('tool-roof'); }
  roofMenuKey(event: KeyboardEvent, group: RoofToolGroup): void {
    event.stopPropagation();
    const root = event.currentTarget as HTMLElement;
    if (event.key === 'Escape') {
      this.closeRoofMenu(); event.preventDefault();
      (root.querySelector('.dropdown-arrow') as HTMLButtonElement).focus(); return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const focusItem = () => {
      const items = Array.from(root.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'));
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index].focus();
    };
    if (this.openRoofMenu !== group) { this.openRoofMenu = group; setTimeout(focusItem); }
    else focusItem();
  }
  openFloors(): void { this.closeRoofMenu(); this.floorsDialog.nativeElement.showModal(); }
  floorDialogKey(event: KeyboardEvent): void {
    event.stopPropagation();
    const history = historyShortcut(event);
    if (history) { event.preventDefault(); history === 'undo' ? this.undo() : this.redo(); }
  }
  editFloor(operation: EditFloor['operation']): void { this.store.dispatch(new EditFloor(operation, this.selectedLevel)); }
  selectFloor(level: number): void {
    if (!this.buildingService.building?.floors[level]) return;
    this.gridService.setSelectedLevel(level);
    this.gridService.showAllTiles(); this.gridService.redrawTiles();
    this.store.dispatch(new ScheduleRedraw(true));
  }
  floorListKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    this.selectFloor(Math.max(0, Math.min(this.floorCount - 1, this.selectedLevel + (event.key === 'ArrowUp' ? 1 : -1))));
  }

  undo(): void { this.store.dispatch(new Undo()); }
  redo(): void { this.store.dispatch(new Redo()); }

  createXml(): void {
    this.buildingService.saveBuildingToXml().catch(error => window.alert(error.message || String(error)));
  }

  openFileUpload(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.tbx';
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
      this.buildingService.createBuildingFromXml(xmlDoc).catch(error => window.alert(error.message || String(error)));
      console.log(xmlDoc);
    }
    reader.readAsText(file);
  }

  toggleWindow() {
    this.store.dispatch(new TogglePopup('tileset-list', true));
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
    this.selectFloor(this.selectedLevel + 1);
  }

  downFloor(): void {
    this.selectFloor(this.selectedLevel - 1);
  }

  openMainMenu(): void {
    this.store.dispatch(new TogglePopup('main-menu', true));
  }

}
