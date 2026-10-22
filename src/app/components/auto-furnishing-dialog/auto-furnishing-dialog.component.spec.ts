import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { EditRooms, SetBuilding, Undo } from '../../app.actions';
import { AutoFurnishingAnalysisService } from '../../services/auto-furnishing-analysis.service';
import { AutoFurnishingService } from '../../services/auto-furnishing.service';
import { DbService } from '../../services/db.service';
import { GridService } from '../../services/grid.service';
import { documentHarness } from '../../testing/document-harness';
import { furnishingBuilding } from '../../testing/furnishing-fixtures';
import { AutoFurnishingDialogComponent } from './auto-furnishing-dialog.component';

describe('Auto furnishing dialog', () => {
    let source: string;
    let h: ReturnType<typeof documentHarness>;
    beforeAll(async () => source = await (await fetch('/assets/BuildingFurniture.txt')).text());
    beforeEach(() => {
        h = documentHarness(furnishingBuilding());
        const db = { getTile: async () => ({ url: '' }) };
        TestBed.configureTestingModule({ declarations: [AutoFurnishingDialogComponent], imports: [CommonModule, FormsModule],
            providers: [{ provide: Store, useValue: h.store }, { provide: GridService, useValue: h.grid }, { provide: DbService, useValue: db },
                { provide: AutoFurnishingAnalysisService, useValue: new AutoFurnishingAnalysisService({ get: () => of(source) } as any, db as any) },
                AutoFurnishingService] });
    });
    afterEach(() => h.destroy());
    const setup = async () => {
        const fixture = TestBed.createComponent(AutoFurnishingDialogComponent); fixture.detectChanges();
        await fixture.componentInstance.open(); fixture.detectChanges();
        return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
    };
    it('opens with empty rooms on the current floor selected and renders a numbered preview and native legend', async () => {
        const { fixture, component, el } = await setup(), before = h.state.value.building;
        expect(component.dialog.nativeElement.open).toBeTrue(); expect(component.selected.size).toBe(1);
        expect(el.querySelectorAll('input[type=checkbox]').length).toBe(1);
        await component.generate(); fixture.detectChanges();
        expect(component.count).toBe(2); expect(el.querySelectorAll('svg text').length).toBe(2);
        expect(el.querySelector('.legend')!.textContent).toContain('bed');
        expect(el.querySelectorAll('.legend img').length).toBe(0); // Missing thumbnail URLs do not hide layout information.
        expect(h.state.value.building).toBe(before); expect(h.state.value.past.length).toBe(0);
        component.close();
    });
    it('regenerates with a new displayed seed and invalidates old previews when selection or seed changes', async () => {
        const { fixture, component, el } = await setup();
        await component.generate(); await component.generate(true); fixture.detectChanges();
        expect(component.preview!.seed).toBe('1:1'); expect(el.textContent).toContain('Preview seed: 1:1');
        const input = el.querySelector('[aria-label="Furnishing seed"]') as HTMLInputElement;
        input.value = 'a-new-house'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
        expect(component.preview).toBeUndefined();
        await component.generate(); fixture.detectChanges(); expect(component.preview!.seed).toBe('a-new-house');
        component.toggleRoom(component.rooms[0]); fixture.detectChanges();
        expect(component.preview).toBeUndefined(); expect(component.selected.size).toBe(0);
        component.close();
    });
    it('applies from the dialog once and exposes one-step undo through the real document history', async () => {
        const { fixture, component, el } = await setup(), before = h.state.value.building;
        await component.generate(); fixture.detectChanges();
        const apply = el.querySelector('.apply') as HTMLButtonElement;
        expect(apply.disabled).toBeFalse(); apply.click(); await fixture.whenStable(); fixture.detectChanges();
        expect(component.dialog.nativeElement.open).toBeFalse(); expect(h.state.value.past.length).toBe(1);
        expect(h.state.value.building!.floors[0].objects.filter(o => o.type === 'furniture').length).toBe(2);
        h.store.dispatch(new Undo()); expect(h.state.value.building).toBe(before);
    });
    it('discards generated and in-flight previews on Cancel and Escape', async () => {
        const { component } = await setup(), before = h.state.value.building;
        await component.generate(); component.dialog.nativeElement.dispatchEvent(new Event('cancel', { cancelable: true }));
        expect(component.dialog.nativeElement.open).toBeFalse(); expect(component.preview).toBeUndefined();
        await component.open(); const pending = component.generate(); component.close(); await pending;
        expect(component.preview).toBeUndefined(); expect(component.busy).toBeFalse();
        expect(h.state.value.building).toBe(before); expect(h.state.value.past.length).toBe(0);
    });
    it('isolates keyboard shortcuts and invalidates previews after an external document edit', async () => {
        const { fixture, component, el } = await setup(); await component.generate();
        const reachedDocument = jasmine.createSpy('canvas shortcut'); document.addEventListener('keydown', reachedDocument);
        try {
            for (const key of ['Delete', 'r', 'z']) component.dialog.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: key === 'z', bubbles: true }));
            expect(reachedDocument).not.toHaveBeenCalled();
        } finally { document.removeEventListener('keydown', reachedDocument); }
        h.store.dispatch(new EditRooms({ x: 5, y: 5, width: 1, height: 1 }, 0, 0)); fixture.detectChanges();
        expect(component.preview).toBeUndefined(); expect(el.querySelector('[role=alert]')!.textContent).toContain('building changed');
        await component.refresh(); fixture.detectChanges(); expect(component.error).toBe('');
        component.close();
    });
    it('requires the visible incomplete-room checkbox before applying a partial layout', async () => {
        h.store.dispatch(new SetBuilding(furnishingBuilding([[1, 1], [1, 1]])));
        const { fixture, component, el } = await setup(); await component.generate(); fixture.detectChanges();
        expect(component.incomplete).toBeTrue(); expect((el.querySelector('.apply') as HTMLButtonElement).disabled).toBeTrue();
        expect(el.textContent).toContain('Missing');
        (el.querySelector('.partial input') as HTMLInputElement).click(); await fixture.whenStable(); fixture.detectChanges();
        expect((el.querySelector('.apply') as HTMLButtonElement).disabled).toBeFalse();
        await component.apply(); expect(h.state.value.past.length).toBe(1);
    });
    it('invalidates a preview when its style changes and retains the chosen set on regeneration and Apply', async () => {
        const { fixture, component, el } = await setup();
        await component.generate(); fixture.detectChanges();
        const select = el.querySelector('[aria-label="Furnishing style"]') as HTMLSelectElement;
        expect(select.options.length).toBe(2);
        select.value = 'alternate-residential'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
        expect(component.preview).toBeUndefined(); expect(component.style).toBe('alternate-residential');
        await component.generate(); await component.generate(true); fixture.detectChanges();
        expect(component.preview!.style).toBe('alternate-residential');
        expect(component.preview!.plans[0].placements.some(p => p.catalogId === 'alternate.chair')).toBeTrue();
        await component.apply(); expect(h.state.value.past.length).toBe(1);
    });
    it('makes an irregular kitchen eligible and shows a style-coordinated preview', async () => {
        const building = furnishingBuilding(Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => x < 4 || y < 4 ? 1 : 0)));
        building.rooms[0] = { ...building.rooms[0], Name: 'Kitchen', InternalName: 'kitchen' };
        h.store.dispatch(new SetBuilding(building));
        const { fixture, component, el } = await setup(); component.style = 'alternate-residential';
        expect(component.selected.size).toBe(1);
        await component.generate(); fixture.detectChanges();
        expect(component.plan!.requiredSatisfied).toBeTrue();
        expect(el.querySelector('.legend')!.textContent).toContain('Alternate kitchen counter');
        expect(el.querySelectorAll('svg text').length).toBe(component.plan!.placements.length);
        expect(h.state.value.past.length).toBe(0); component.close();
    });
});
