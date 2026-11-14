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
import { Undo, ResizeBuilding } from '../app.actions';
import { RoomTilePickerComponent } from '../components/room-tile-picker/room-tile-picker.component';
import { DbService } from '../services/db.service';
import { AutoFurnishingDialogComponent } from '../components/auto-furnishing-dialog/auto-furnishing-dialog.component';
import { AutoFurnishingService } from '../services/auto-furnishing.service';
import { RouterTestingModule } from '@angular/router/testing';
import { EditorSessionService } from '../services/editor-session.service';

describe('Native toolbar controls', () => {
    let h: ReturnType<typeof documentHarness>;
    beforeEach(() => {
        localStorage.clear();
        h = documentHarness(readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')));
        TestBed.configureTestingModule({ declarations: [MenuComponent, RoomsDialogComponent, RoomTilePickerComponent, AutoFurnishingDialogComponent], imports: [CommonModule, FormsModule, RouterTestingModule, NoopAnimationsModule, BsDropdownModule.forRoot()],
            providers: [{ provide: Store, useValue: h.store }, { provide: BuildingService, useValue: h.buildings },
                { provide: AutoFurnishingService, useValue: {} },
                { provide: EditorSessionService, useValue: { worldBuilding: undefined, projectDocument: false,
                    saveLocalDraft: jasmine.createSpy('saveLocalDraft'), save: jasmine.createSpy('save').and.resolveTo(true) } },
                { provide: DbService, useValue: { getTile: async () => null, getTilesets: async () => [], getTiles: async () => [] } },
                { provide: GridService, useValue: h.grid }, { provide: RoomService, useValue: h.rooms }, RoofService] });
    });
    afterEach(() => h.destroy());

    it('rotates all floors from the toolbar with one history entry and reports unsafe border tiles', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const before = h.buildings.building;
        const rotate = fixture.nativeElement.querySelector('[aria-label="Rotate building right"]') as HTMLButtonElement;
        rotate.click(); fixture.detectChanges();
        expect(h.buildings.building).toBe(before); // Fixture has a painted southeast border tile.
        expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('would move outside');
        h.store.dispatch(new ResizeBuilding({ width: 4, height: 3, offsetX: 0, offsetY: 0 }, 0));
        const enlarged = h.buildings.building;
        rotate.click(); fixture.detectChanges();
        expect([h.buildings.building.width, h.buildings.building.height]).toEqual([3, 4]);
        expect(h.state.value.past.length).toBe(2);
        fixture.componentInstance.undo(); expect(h.buildings.building).toBe(enlarged);
        const session = TestBed.inject(EditorSessionService); session.busy = true; fixture.detectChanges();
        expect(rotate.disabled).toBeTrue(); fixture.componentInstance.transform('flip-horizontal');
        expect(h.buildings.building).toBe(enlarged);
    });

    it('resizes through the dimension and offset controls and supports undo', async () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement, before = h.buildings.building;
        (el.querySelector('[aria-label="Resize building area"]') as HTMLButtonElement).click(); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        const dialog = el.querySelector<HTMLDialogElement>('dialog.resize-dialog')!;
        expect(dialog.open).toBeTrue();
        const input = (name: string, value: string) => {
            const field = dialog.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
            field.value = value; field.dispatchEvent(new Event('input')); fixture.detectChanges();
        };
        input('resizeWidth', '5'); input('resizeHeight', '4'); input('resizeOffsetX', '2'); input('resizeOffsetY', '1');
        expect(fixture.componentInstance.resize).toEqual({ width: 5, height: 4, offsetX: 2, offsetY: 1 });
        (dialog.querySelector('.resize-submit') as HTMLButtonElement).click(); fixture.detectChanges();
        expect(dialog.open).toBeFalse();
        expect([h.buildings.building.width, h.buildings.building.height]).toEqual([5, 4]);
        expect(h.buildings.building.floors[0].objects[0].x).toBe(2);
        expect(h.buildings.building.floors[0].objects[0].y).toBe(1);
        expect(h.state.value.past.length).toBe(1);
        fixture.componentInstance.undo(); expect(h.buildings.building).toBe(before);
    });

    it('confirms shrinking, leaves cancelled changes alone, and validates dimensions and offsets', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const menu = fixture.componentInstance, before = h.buildings.building;
        menu.openResize(); menu.resize.width = 1; fixture.detectChanges();
        const confirm = spyOn(window, 'confirm').and.returnValue(false);
        menu.applyResize(); expect(confirm).toHaveBeenCalled(); expect(h.buildings.building).toBe(before);
        expect(menu.resizeDialog.nativeElement.open).toBeTrue();
        menu.resize.width = 257; expect(menu.validResize).toBeFalse();
        menu.resize.width = 1.5; expect(menu.validResize).toBeFalse();
        menu.resize.width = 1; menu.resize.offsetX = 1; expect(menu.validResize).toBeFalse();
        menu.resize.offsetX = 0; confirm.and.returnValue(true); menu.applyResize();
        expect(h.buildings.building.width).toBe(1); expect(menu.resizeDialog.nativeElement.open).toBeFalse();
        menu.undo(); menu.openResize(); menu.resize.width = 4;
        menu.resizeDialog.nativeElement.close(); expect(h.buildings.building).toBe(before);
    });

    it('crops from the toolbar, reports the result and ignores locked documents', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const before = h.buildings.building;
        h.store.dispatch(new ResizeBuilding({ width: 8, height: 6, offsetX: 3, offsetY: 2 }, 0));
        fixture.detectChanges();
        (fixture.nativeElement.querySelector('[aria-label="Crop to minimum"]') as HTMLButtonElement).click(); fixture.detectChanges();
        expect([h.buildings.building.width, h.buildings.building.height]).toEqual([2, 2]);
        expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('2 × 2');
        fixture.componentInstance.undo(); expect(h.buildings.building.width).toBe(8);
        const session = TestBed.inject(EditorSessionService); session.busy = true;
        fixture.detectChanges();
        expect((fixture.nativeElement.querySelector('[aria-label="Crop to minimum"]') as HTMLButtonElement).disabled).toBeTrue();
        fixture.componentInstance.cropToMinimum(); expect(h.buildings.building.width).toBe(8);
        session.busy = false; fixture.componentInstance.undo(); expect(h.buildings.building).toBe(before);
    });

    it('keeps resize dialog keys away from drawing shortcuts and clamps offsets when dimensions change', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const menu = fixture.componentInstance; menu.openResize();
        menu.resize.width = 6; menu.resize.offsetX = 4;
        menu.resize.width = 3; menu.clampResizeOffsets(); expect(menu.resize.offsetX).toBe(1);
        const reachedDocument = jasmine.createSpy('drawing shortcut'); document.addEventListener('keydown', reachedDocument);
        try {
            menu.resizeDialog.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
            expect(reachedDocument).not.toHaveBeenCalled();
        } finally { document.removeEventListener('keydown', reachedDocument); menu.resizeDialog.nativeElement.close(); }
    });

    it('saves a shared building through the project session instead of downloading a variant', () => {
        const fixture = TestBed.createComponent(MenuComponent);
        const session = TestBed.inject(EditorSessionService);
        session.worldBuilding = { projectId: 'project', path: 'house.tbx', revision: 2 };
        const download = spyOn(h.buildings, 'saveBuildingToXml').and.resolveTo(undefined);
        fixture.componentInstance.createXml();
        expect(session.save).toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
    });

    it('keeps the toolbar save local until the new building is explicitly added to the world', () => {
        const fixture = TestBed.createComponent(MenuComponent);
        const session = TestBed.inject(EditorSessionService);
        session.newWorldBuilding = true;
        session.worldBuilding = { projectId: 'project', path: 'house.tbx', revision: 2 };
        fixture.componentInstance.createXml();
        expect(session.saveLocalDraft).toHaveBeenCalled();
        expect(session.save).not.toHaveBeenCalled();
    });

    it('opens auto furnishing from its toolbar control', () => {
        const fixture = TestBed.createComponent(MenuComponent); fixture.detectChanges();
        const dialog = fixture.debugElement.query(By.directive(AutoFurnishingDialogComponent)).componentInstance as AutoFurnishingDialogComponent;
        const open = spyOn(dialog, 'open').and.resolveTo();
        (fixture.nativeElement.querySelector('[aria-label="Auto furnish rooms"]') as HTMLButtonElement).click();
        expect(open).toHaveBeenCalled();
    });

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
