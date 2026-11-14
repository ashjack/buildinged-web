import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';
import { ScheduleRedraw, SetCurrentTool, TogglePopup } from '../app.actions';
import { BuildingService } from '../services/building.service';
import { Building, Room } from '../models/app.models';
import { RoomService } from '../services/room.service';
import { GridService } from '../services/grid.service';
import { Undo, Redo, EditFloor, ResizeBuilding, CropBuildingToMinimum, TransformBuilding } from '../app.actions';
import { BuildingTransform, transformBuilding } from '../utils/building-transform';
import { BuildingResize, MAX_BUILDING_DIMENSION, minimumBuildingBounds, validBuildingResize } from '../utils/building-resize';
import { RoofService } from '../services/roof.service';
import { RoofOption } from '../services/roof-patterns';
import { ROOF_TOOL_GROUPS, roofOptionIcon, roofToolGroup, RoofToolGroup } from '../utils/roof-toolbar';
import { MAX_BUILDING_FLOORS } from '../utils/floor-edits';
import { historyShortcut } from '../utils/editor-shortcuts';
import { Router } from '@angular/router';
import { EditorSessionService } from '../services/editor-session.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent {
  @ViewChild('floorsDialog') floorsDialog: ElementRef<HTMLDialogElement>;
  @ViewChild('resizeDialog') resizeDialog: ElementRef<HTMLDialogElement>;
  readonly maxDimension = MAX_BUILDING_DIMENSION;
  resize: BuildingResize = { width: 1, height: 1, offsetX: 0, offsetY: 0 };
  resizeSource?: Building;
  resizeMessage = '';
  private resizeDrag?: { x: number; y: number; offsetX: number; offsetY: number };
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
    public roofs: RoofService,
    private router: Router,
    public session: EditorSessionService
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

  transform(operation: BuildingTransform): void {
    if (!this.canResize) return;
    this.closeRoofMenu();
    this.resizeMessage = '';
    try {
      transformBuilding(this.buildingService.building, operation);
      this.store.dispatch(new TransformBuilding(operation, this.selectedLevel));
    } catch (error) { this.resizeMessage = error instanceof Error ? error.message : String(error); }
  }

  get canResize(): boolean {
    return !!this.floorCount && !this.session.busy && (!this.session.projectDocument || this.session.editable);
  }
  get validResize(): boolean {
    return this.canResize && this.resizeSource === this.buildingService.building && validBuildingResize(this.resize)
      && this.resize.offsetX >= this.offsetMin('X') && this.resize.offsetX <= this.offsetMax('X')
      && this.resize.offsetY >= this.offsetMin('Y') && this.resize.offsetY <= this.offsetMax('Y');
  }
  offsetMin(axis: 'X' | 'Y'): number {
    return Math.min(0, (axis === 'X' ? this.resize.width - (this.resizeSource?.width || 1) : this.resize.height - (this.resizeSource?.height || 1)) || 0);
  }
  offsetMax(axis: 'X' | 'Y'): number {
    return Math.max(0, (axis === 'X' ? this.resize.width - (this.resizeSource?.width || 1) : this.resize.height - (this.resizeSource?.height || 1)) || 0);
  }
  clampResizeOffsets(): void {
    this.resize.offsetX = Math.max(this.offsetMin('X'), Math.min(this.offsetMax('X'), this.resize.offsetX));
    this.resize.offsetY = Math.max(this.offsetMin('Y'), Math.min(this.offsetMax('Y'), this.resize.offsetY));
  }
  get resizeWillCrop(): boolean {
    const b = this.resizeSource, r = this.resize;
    return !!b && (r.offsetX < 0 || r.offsetY < 0 || r.offsetX + b.width > r.width || r.offsetY + b.height > r.height);
  }
  get resizePreview() {
    const b = this.resizeSource, r = this.resize;
    const width = Math.max(1, Number(r.width) || 1), height = Math.max(1, Number(r.height) || 1);
    const scale = Math.min(260 / Math.max(width, 2 * (b?.width || 1) - width),
      150 / Math.max(height, 2 * (b?.height || 1) - height));
    return { x: (280 - width * scale) / 2, y: (170 - height * scale) / 2, width: width * scale, height: height * scale, scale };
  }
  startResizeDrag(event: PointerEvent): void {
    if (event.button !== 0 || !this.validResize) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.resizeDrag = { x: event.clientX, y: event.clientY, offsetX: this.resize.offsetX, offsetY: this.resize.offsetY };
    event.preventDefault();
  }
  moveResizeDrag(event: PointerEvent): void {
    if (!this.resizeDrag) return;
    const element = event.currentTarget as Element;
    const scale = this.resizePreview.scale * element.getBoundingClientRect().width / 280;
    this.resize.offsetX = this.resizeDrag.offsetX + Math.round((event.clientX - this.resizeDrag.x) / scale);
    this.resize.offsetY = this.resizeDrag.offsetY + Math.round((event.clientY - this.resizeDrag.y) / scale);
    this.clampResizeOffsets();
  }
  endResizeDrag(): void { this.resizeDrag = undefined; }
  openResize(): void {
    if (!this.canResize) return;
    this.closeRoofMenu();
    this.resizeSource = this.buildingService.building;
    this.resize = { width: this.resizeSource.width, height: this.resizeSource.height, offsetX: 0, offsetY: 0 };
    this.resizeMessage = '';
    this.resizeDialog.nativeElement.showModal();
  }
  applyResize(): void {
    if (!this.validResize) return;
    if (this.resizeWillCrop && !window.confirm('Rooms, tiles, and objects outside the new building bounds will be cropped. Continue resizing?')) return;
    this.store.dispatch(new ResizeBuilding({ ...this.resize }, this.selectedLevel));
    this.resizeDialog.nativeElement.close();
  }
  cropToMinimum(): void {
    if (!this.canResize) return;
    const before = this.buildingService.building;
    if (!minimumBuildingBounds(before)) { this.resizeMessage = 'There is no placed content to crop to.'; return; }
    this.store.dispatch(new CropBuildingToMinimum(this.selectedLevel));
    const after = this.buildingService.building;
    const removed = before.floors.reduce((count, floor, index) => count + floor.objects.length - after.floors[index].objects.length, 0);
    this.resizeMessage = after === before ? 'The area already fits the placed content.' : `Area cropped to ${after.width} × ${after.height} tiles.`;
    if (removed) window.alert('Some objects were deleted during cropping. Use Undo to restore them.');
  }

  createXml(): void {
    if (this.session.guest) { void this.session.save(); return; }
    if (this.session.newWorldBuilding) { this.session.saveLocalDraft(); return; }
    if (this.session.worldBuilding) { void this.session.save(); return; }
    this.buildingService.saveBuildingToXml().catch(error => window.alert(error.message || String(error)));
  }

  openFileUpload(): void {
    if (this.router.url.includes('/variants/') || this.session.projectDocument) {
      window.alert('Open files in the standalone editor. Return to the project to choose another building.');
      return;
    }
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
    void this.router.navigate(['/']);
  }

}
