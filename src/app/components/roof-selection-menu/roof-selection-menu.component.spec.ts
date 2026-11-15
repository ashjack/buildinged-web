import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { RoofSelectionMenuComponent } from './roof-selection-menu.component';
import { RoofService } from '../../services/roof.service';
import { BuildingService } from '../../services/building.service';
import { GridService } from '../../services/grid.service';
import { documentHarness } from '../../testing/document-harness';
import { nativeBuildingXml } from '../../testing/native-building.fixture';
import { readBuildingFile } from '../../utils/tbx-format';

describe('Compound roof dimension controls', () => {
    let h: ReturnType<typeof documentHarness>, roofs: RoofService;
    beforeEach(() => {
        localStorage.clear(); const b = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
        b.width = b.height = 32; b.floors = [{ rooms: '', objects: [] }];
        h = documentHarness(b); roofs = new RoofService(h.buildings, h.grid, h.store as any); roofs.setSelectedRoofOptionId('l-roof30');
        TestBed.configureTestingModule({ declarations: [RoofSelectionMenuComponent], imports: [CommonModule, FormsModule],
            providers: [{ provide: RoofService, useValue: roofs }, { provide: BuildingService, useValue: h.buildings },
                { provide: GridService, useValue: h.grid }, { provide: Store, useValue: h.store }] });
    });
    afterEach(() => h.destroy());
    it('uses four editable number steppers, increments one tile, and restores invalid or empty entries', () => {
        const fixture = TestBed.createComponent(RoofSelectionMenuComponent); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('select')).toBeNull();
        expect(el.querySelectorAll('fieldset input[type=number]').length).toBe(4);
        const enter = (label: string, value: string) => {
            const field = el.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
            field.value = value; field.dispatchEvent(new Event('change')); fixture.detectChanges(); return field;
        };
        enter('Main wing length', '12'); enter('Return wing length', '10'); enter('Main wing width', '5'); enter('Return wing width', '3');
        (el.querySelector('[aria-label="Increase main wing length"]') as HTMLButtonElement).click(); fixture.detectChanges();
        (el.querySelector('[aria-label="Decrease return wing width"]') as HTMLButtonElement).click(); fixture.detectChanges();
        expect(roofs.compoundDimensions).toEqual({ mainLength: 13, mainWidth: 5, returnLength: 10, returnWidth: 2 });
        expect(enter('Main wing length', '1').value).toBe('13');
        expect(enter('Main wing width', '').value).toBe('5');
        (el.querySelector('[aria-label="Increase roof orientation"]') as HTMLButtonElement).click(); fixture.detectChanges();
        expect((el.querySelector('[aria-label="Roof orientation"]') as HTMLInputElement).value).toBe('90');
        expect(roofs.compoundDimensions).toEqual({ mainLength: 13, mainWidth: 5, returnLength: 10, returnWidth: 2 });
    });
    it('disables dimensions during a drag and shows the same controls for a T roof', () => {
        const fixture = TestBed.createComponent(RoofSelectionMenuComponent); roofs.setSelectedRoofOptionId('t-roof30'); fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelectorAll('fieldset input[type=number]').length).toBe(4);
        roofs.drawing = true; fixture.detectChanges();
        expect(Array.from(el.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.number-stepper input, .number-stepper button')).every(control => control.disabled)).toBeTrue();
    });
});
