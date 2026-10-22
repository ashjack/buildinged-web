import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { BuildingService } from '../services/building.service';
import { GridService } from '../services/grid.service';
import { RoofService } from '../services/roof.service';
import { RoomService } from '../services/room.service';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile } from '../utils/tbx-format';
import { ROOF_TOOL_GROUPS, roofOptionIcon } from '../utils/roof-toolbar';
import { MenuComponent } from './menu.component';
import { RoomsDialogComponent } from '../components/rooms-dialog/rooms-dialog.component';
import { By } from '@angular/platform-browser';
import { Undo } from '../app.actions';
import { RoomTilePickerComponent } from '../components/room-tile-picker/room-tile-picker.component';
import { DbService } from '../services/db.service';

describe('Native toolbar controls', () => {
    let h: ReturnType<typeof documentHarness>;
    beforeEach(() => {
        localStorage.clear();
        h = documentHarness(readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')));
        TestBed.configureTestingModule({ declarations: [MenuComponent, RoomsDialogComponent, RoomTilePickerComponent], imports: [CommonModule, FormsModule, NoopAnimationsModule, BsDropdownModule.forRoot()],
            providers: [{ provide: Store, useValue: h.store }, { provide: BuildingService, useValue: h.buildings },
                { provide: DbService, useValue: { getTile: async () => null, getTilesets: async () => [], getTiles: async () => [] } },
                { provide: GridService, useValue: h.grid }, { provide: RoomService, useValue: h.rooms }, RoofService] });
    });
    afterEach(() => h.destroy());

    it('opens Rooms from the toolbar and commits a newly created room on OK in one undoable edit', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement, before = h.buildings.building;
        (el.querySelector('[aria-label="Edit rooms"]') as HTMLButtonElement).click(); fixture.detectChanges();
        const editor: RoomsDialogComponent = fixture.debugElement.query(By.directive(RoomsDialogComponent)).componentInstance;
        expect(editor.dialog.nativeElement.open).toBeTrue();
        (el.querySelector('[aria-label="Add room"]') as HTMLButtonElement).click(); fixture.detectChanges();
        const input = el.querySelector('[aria-label="Room name"]') as HTMLInputElement;
        input.value = 'New workshop'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
        expect(h.buildings.building).toBe(before);
        (Array.from(el.querySelectorAll('app-rooms-dialog button')).find(button => button.textContent!.trim() === 'OK') as HTMLButtonElement).click(); fixture.detectChanges();
        expect(h.buildings.building.rooms[1].Name).toBe('New workshop');
        expect(h.rooms.selectedRoom?.Name).toBe('New workshop'); expect(h.state.value.past.length).toBe(1);
        expect(editor.dialog.nativeElement.open).toBeFalse();
        h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
    });

    it('discards room edits, additions and removals on Cancel and Escape', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const editor: RoomsDialogComponent = fixture.debugElement.query(By.directive(RoomsDialogComponent)).componentInstance;
        const before = h.buildings.building;
        editor.open(); editor.room!.Name = 'Discard me'; editor.add(); editor.duplicate(); editor.remove(); editor.move(-1);
        editor.cancel(); expect(h.buildings.building).toBe(before); expect(h.state.value.past.length).toBe(0);
        editor.open(); editor.remove();
        editor.dialog.nativeElement.dispatchEvent(new Event('cancel', { cancelable: true }));
        expect(editor.dialog.nativeElement.open).toBeFalse(); expect(h.buildings.building).toBe(before);
    });

    it('keeps room dialog keys away from canvas shortcuts', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const editor: RoomsDialogComponent = fixture.debugElement.query(By.directive(RoomsDialogComponent)).componentInstance;
        editor.open(); fixture.detectChanges();
        const reachedDocument = jasmine.createSpy('drawing shortcut'); document.addEventListener('keydown', reachedDocument);
        try {
            editor.dialog.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
            editor.dialog.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
            expect(reachedDocument).not.toHaveBeenCalled();
        } finally { document.removeEventListener('keydown', reachedDocument); editor.cancel(); }
    });

    it('has the native roof menu groupings and independent remembered selections', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const menu = fixture.componentInstance, el: HTMLElement = fixture.nativeElement;
        expect(el.querySelectorAll('.roof-split').length).toBe(3);
        expect(ROOF_TOOL_GROUPS.map(g => g.options.length)).toEqual([11, 6, 8]);
        (el.querySelector('[aria-label="Shallow roofs types"]') as HTMLButtonElement).click(); fixture.detectChanges();
        const options = el.querySelectorAll('.roof-menu button'); expect(options.length).toBe(6);
        (options[1] as HTMLButtonElement).click(); fixture.detectChanges();
        expect(menu.roofs.getSelectedRoofType()).toBe('ShallowSlopeE'); expect(h.state.value.currentTool).toBe('tool-roof');
        menu.activateRoof('standard'); expect(menu.roofs.getSelectedRoofType()).toBe('PeakNS');
        menu.activateRoof('corners'); expect(menu.roofs.getSelectedRoofType()).toBe('CornerInnerNW');
        menu.activateRoof('shallow'); expect(menu.roofs.getSelectedRoofType()).toBe('ShallowSlopeE');
        expect(el.querySelector('.roof-menu')).toBeNull();
        expect(ROOF_TOOL_GROUPS.flatMap(g => g.options).every(o => roofOptionIcon(o).startsWith('assets/icons/icon_'))).toBeTrue();
    });

    it('opens a modal floor list and applies add, reorder, and undo through its controls', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        const click = (label: string) => { (el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click(); fixture.detectChanges(); };
        click('Edit floors'); expect(el.querySelector<HTMLDialogElement>('dialog.floors-dialog')!.open).toBeTrue();
        expect((el.querySelector('[aria-label="Remove floor"]') as HTMLButtonElement).disabled).toBeTrue();
        click('Add floor'); expect(h.buildings.building.floors.length).toBe(2);
        expect(Array.from(el.querySelectorAll('[role=option]')).map(o => o.textContent!.trim())).toEqual(['Floor 2', 'Floor 1']);
        click('Lower floor'); expect(h.grid.getSelectedLevel()).toBe(0);
        const undo = Array.from(el.querySelectorAll('dialog.floors-dialog button')).find(b => b.textContent!.trim() === 'Undo') as HTMLButtonElement;
        undo.click(); fixture.detectChanges(); expect(h.grid.getSelectedLevel()).toBe(1);
        (el.querySelector('.dialog-ok') as HTMLButtonElement).click(); expect(el.querySelector<HTMLDialogElement>('dialog.floors-dialog')!.open).toBeFalse();
    });

    it('navigates roof menus with arrow keys and returns focus to the dropdown on Escape', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        const arrow = el.querySelector('[aria-label="Roofs types"]') as HTMLButtonElement;
        arrow.click(); fixture.detectChanges(); arrow.focus();
        arrow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        const items = el.querySelectorAll<HTMLButtonElement>('.roof-menu button');
        expect(document.activeElement).toBe(items[10]);
        items[10].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(items[0]);
        items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
        expect(el.querySelector('.roof-menu')).toBeNull(); expect(document.activeElement).toBe(arrow);
    });

    it('keeps floor selection and history keys inside the modal instead of passing them to drawing tools', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement, menu = fixture.componentInstance;
        menu.openFloors(); menu.editFloor('add'); fixture.detectChanges();
        const reachedDocument = jasmine.createSpy('drawing shortcut');
        document.addEventListener('keydown', reachedDocument);
        try {
            const list = el.querySelector('.floor-list')!;
            list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            expect(h.grid.getSelectedLevel()).toBe(0);
            list.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
            expect(h.buildings.building.floors.length).toBe(1);
            list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
            expect(reachedDocument).not.toHaveBeenCalled();
        } finally { document.removeEventListener('keydown', reachedDocument); menu.floorsDialog.nativeElement.close(); }
    });
});
