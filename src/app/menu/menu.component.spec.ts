import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
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

describe('Native toolbar controls', () => {
    let h: ReturnType<typeof documentHarness>;
    beforeEach(() => {
        localStorage.clear();
        h = documentHarness(readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml')));
        TestBed.configureTestingModule({ declarations: [MenuComponent], imports: [CommonModule, NoopAnimationsModule, BsDropdownModule.forRoot()],
            providers: [{ provide: Store, useValue: h.store }, { provide: BuildingService, useValue: h.buildings },
                { provide: GridService, useValue: h.grid }, { provide: RoomService, useValue: h.rooms }, RoofService] });
    });
    afterEach(() => h.destroy());

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
        click('Edit floors'); expect(el.querySelector('dialog')!.open).toBeTrue();
        expect((el.querySelector('[aria-label="Remove floor"]') as HTMLButtonElement).disabled).toBeTrue();
        click('Add floor'); expect(h.buildings.building.floors.length).toBe(2);
        expect(Array.from(el.querySelectorAll('[role=option]')).map(o => o.textContent!.trim())).toEqual(['Floor 2', 'Floor 1']);
        click('Lower floor'); expect(h.grid.getSelectedLevel()).toBe(0);
        const undo = Array.from(el.querySelectorAll('dialog button')).find(b => b.textContent!.trim() === 'Undo') as HTMLButtonElement;
        undo.click(); fixture.detectChanges(); expect(h.grid.getSelectedLevel()).toBe(1);
        (el.querySelector('.dialog-ok') as HTMLButtonElement).click(); expect(el.querySelector('dialog')!.open).toBeFalse();
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
