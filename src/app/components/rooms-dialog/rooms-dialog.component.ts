import { Component, ElementRef, ViewChild } from '@angular/core';
import { Store } from '@ngrx/store';
import { EditRoomDefinitions, ScheduleRedraw } from '../../app.actions';
import * as fromRoot from '../../app.reducers';
import { Room, TileEntry } from '../../models/app.models';
import { BuildingService } from '../../services/building.service';
import { GridService } from '../../services/grid.service';
import { RoomService } from '../../services/room.service';
import { newRoomDefinition, ROOM_MATERIALS, RoomDefinitionDraft, unusedRoomColor } from '../../utils/room-definitions';
import { roomEntryDisplay } from '../../utils/room-tile-entries';
import { RoomTilePickerComponent } from '../room-tile-picker/room-tile-picker.component';

@Component({
    selector: 'app-rooms-dialog',
    templateUrl: './rooms-dialog.component.html',
    styleUrls: ['./rooms-dialog.component.scss'],
})
export class RoomsDialogComponent {
    @ViewChild('dialog') dialog: ElementRef<HTMLDialogElement>;
    @ViewChild('roomName') roomName?: ElementRef<HTMLInputElement>;
    @ViewChild(RoomTilePickerComponent) tilePicker: RoomTilePickerComponent;
    drafts: RoomDefinitionDraft[] = [];
    selected = -1;
    originalRooms: Room[] = [];
    readonly materials = ROOM_MATERIALS;
    selectedMaterial = ROOM_MATERIALS[0];
    readonly tileName = roomEntryDisplay;
    get selectedDefinition(): TileEntry | null {
        const draft = this.drafts[this.selected];
        if (!draft) return null;
        if (draft.materials && this.selectedMaterial.key in draft.materials) return draft.materials[this.selectedMaterial.key] || null;
        return this.buildings.building.entries[draft.room[this.selectedMaterial.key] - 1] || null;
    }
    chooseTile(): void {
        if (this.room) void this.tilePicker.open(this.selectedMaterial.category, this.selectedMaterial.label, this.room.Name, this.selectedDefinition);
    }
    tileChosen(entry: TileEntry | null): void {
        const draft = this.drafts[this.selected];
        if (draft) draft.materials = { ...draft.materials, [this.selectedMaterial.key]: entry };
    }
    error = '';
    get room(): Room | undefined { return this.drafts[this.selected]?.room; }
    get valid(): boolean { return this.drafts.every(draft => draft.room.Name.trim() && draft.room.InternalName.trim()); }
    constructor(private buildings: BuildingService, private rooms: RoomService, private grid: GridService, private store: Store<fromRoot.State>) { }

    open(): void {
        const building = this.buildings.building;
        if (!building) return;
        this.originalRooms = building.rooms;
        this.drafts = building.rooms.map((room, originalIndex) => ({ originalIndex, room: { ...room } }));
        this.selected = this.drafts.length ? Math.max(0, Math.min(this.rooms.selectedRoomIndex, this.drafts.length - 1)) : -1;
        this.error = '';
        this.selectedMaterial = this.materials[0];
        this.dialog.nativeElement.showModal();
    }
    cancel(): void { this.dialog.nativeElement.close(); this.drafts = []; this.selected = -1; }
    private focusName(): void { setTimeout(() => { this.roomName?.nativeElement.focus(); this.roomName?.nativeElement.select(); }); }
    add(): void {
        this.drafts.push({ originalIndex: null, room: newRoomDefinition(this.buildings.building, this.drafts.map(d => d.room)) });
        this.selected = this.drafts.length - 1; this.focusName();
    }
    duplicate(): void {
        if (!this.room) return;
        const room = { ...this.room, Color: unusedRoomColor(this.drafts.map(d => d.room)) };
        const materials = this.drafts[this.selected].materials;
        this.drafts.splice(this.selected + 1, 0, { originalIndex: null, room, ...(materials ? { materials: { ...materials } } : {}) });
        this.selected++; this.focusName();
    }
    remove(): void {
        if (!this.room) return;
        this.drafts.splice(this.selected, 1); this.selected = Math.min(this.selected, this.drafts.length - 1);
    }
    move(offset: number): void {
        const next = this.selected + offset;
        if (!this.room || next < 0 || next >= this.drafts.length) return;
        [this.drafts[this.selected], this.drafts[next]] = [this.drafts[next], this.drafts[this.selected]];
        this.selected = next;
    }
    listKey(event: KeyboardEvent): void {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault(); this.selected = Math.max(0, Math.min(this.drafts.length - 1, this.selected + (event.key === 'ArrowDown' ? 1 : -1)));
    }
    get colorHex(): string {
        return '#' + (this.room?.Color || '255 255 255').split(' ').map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
    }
    set colorHex(hex: string) {
        if (this.room && /^#[0-9a-f]{6}$/i.test(hex)) this.room.Color = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ');
    }
    apply(): void {
        if (!this.valid) return;
        if (this.buildings.building.rooms !== this.originalRooms) {
            this.error = 'The room list changed while this dialog was open. Close and reopen Rooms to continue.'; return;
        }
        this.store.dispatch(new EditRoomDefinitions(this.originalRooms, this.drafts, this.grid.getSelectedLevel()));
        this.rooms.selectedRoomIndex = Math.max(0, this.selected);
        this.store.dispatch(new ScheduleRedraw(true));
        this.dialog.nativeElement.close();
    }
}
