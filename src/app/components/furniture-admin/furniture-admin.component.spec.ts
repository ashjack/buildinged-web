import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { AuthService } from '../../services/auth.service';
import { DbService } from '../../services/db.service';
import { FurnitureLibraryService } from '../../services/furniture-library.service';
import { BuildingTilesLibraryService } from '../../services/building-tiles-library.service';
import { TileAdminService } from '../../services/tile-admin.service';
import { parseBuildingTilesDocument, serializeBuildingTiles, updateCategoryEntries } from '../../utils/building-tiles';
import { FurnitureCellComponent } from './furniture-cell.component';
import { FurnitureAdminComponent } from './furniture-admin.component';

describe('Admin window wall openings', () => {
  let admin: { getFurniture: jasmine.Spy; getBuildingTiles: jasmine.Spy; saveBuildingTiles: jasmine.Spy };
  beforeEach(() => {
    localStorage.clear();
    const document = updateCategoryEntries(parseBuildingTilesDocument('version = 4\nrevision = 4\n'), 'windows', () => [
      { tiles: { West: 'custom_windows_000', North: 'custom_windows_001' } },
      { tiles: { West: 'fixtures_windows_church_004', North: '' } },
    ]);
    admin = {
      getFurniture: jasmine.createSpy().and.resolveTo({ generation: 0, text: 'version = 0\n' }),
      getBuildingTiles: jasmine.createSpy().and.resolveTo({ generation: 3, text: serializeBuildingTiles(document) }),
      saveBuildingTiles: jasmine.createSpy().and.resolveTo({ generation: 4, revision: 5 }),
    };
    TestBed.configureTestingModule({
      declarations: [FurnitureAdminComponent, FurnitureCellComponent], imports: [CommonModule, FormsModule, RouterTestingModule],
      providers: [
        { provide: TileAdminService, useValue: admin }, { provide: AuthService, useValue: { user: null } },
        { provide: FurnitureLibraryService, useValue: { published: async () => undefined } },
        { provide: BuildingTilesLibraryService, useValue: { published: async () => undefined } },
        { provide: DbService, useValue: { getTilesets: async () => [], getTileSprite: async () => null, getTileBitmap: async () => null } },
      ],
    });
  });

  it('edits each facing from the admin controls, supports undo/redo, and publishes the selected openings', async () => {
    const fixture = TestBed.createComponent(FurnitureAdminComponent); fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance, el: HTMLElement = fixture.nativeElement;
    component.selectTileCategory('windows'); fixture.detectChanges(); await fixture.whenStable();
    const west = el.querySelector<HTMLSelectElement>('[aria-label="West window opening"]')!;
    const north = el.querySelector<HTMLSelectElement>('[aria-label="North window opening"]')!;
    expect(west.options.length).toBe(21);
    west.value = '7'; west.dispatchEvent(new Event('change')); fixture.detectChanges();
    north.value = '0'; north.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(component.currentTileEntry!.windowShapes).toEqual({ West: 7, North: 0 });
    expect(component.windowOpeningPreview(component.currentTileEntry!, 'West')['background-position']).toBe('-256px -256px');
    component.undo(); expect(component.currentTileEntry!.windowShapes).toEqual({ West: 7 });
    component.redo(); expect(component.currentTileEntry!.windowShapes).toEqual({ West: 7, North: 0 });
    component.toggleExpertMode(); fixture.detectChanges(); await fixture.whenStable();
    expect(el.querySelector('[aria-label="West window opening"]')).not.toBeNull();
    await component.save();
    const [saved, generation] = admin.saveBuildingTiles.calls.mostRecent().args;
    expect(generation).toBe(3); expect(saved.revision).toBe(5);
    expect(saved.categories.find((category: { name: string }) => category.name === 'windows').entries[0].windowShapes).toEqual({ West: 7, North: 0 });
    expect(component.dirty).toBeFalse();
    component.setWindowOpening('West', 'auto');
    expect(component.currentTileEntry!.windowShapes).toEqual({ North: 0 });
  });

  it('keeps opening edits on the selected window and disables missing facings', async () => {
    const fixture = TestBed.createComponent(FurnitureAdminComponent); fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    component.selectTileCategory('windows'); component.selectTileEntry(1); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-label="North window opening"]').disabled).toBeTrue();
    component.setWindowOpening('West', '19');
    expect(component.tileEntries[0].windowShapes).toBeUndefined();
    expect(component.tileEntries[1].windowShapes).toEqual({ West: 19 });
    component.setWindowOpening('North', '2'); component.setWindowOpening('West', '20');
    expect(component.tileEntries[1].windowShapes).toEqual({ West: 19 });
    component.setWindowOpening('West', 'auto'); expect(component.currentTileEntry!.windowShapes).toBeUndefined();
    expect(component.automaticWindowOpening(component.currentTileEntry!, 'West')).toBe('Opening 3');
  });
});
