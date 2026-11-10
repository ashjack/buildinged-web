import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { nativeBuildingXml } from '../../testing/native-building.fixture';
import { TilezedBuildingPaletteComponent } from './tilezed-building-palette.component';

describe('TileZed building preview browser', () => {
  let fixture: ComponentFixture<TilezedBuildingPaletteComponent>;
  let previews: jasmine.SpyObj<BuildingPreviewService>;
  const files = (count: number) => new Map(Array.from({ length: count }, (_, i) => {
    const file = new File([nativeBuildingXml], `house${i}.tbx`);
    spyOn(file, 'text').and.resolveTo(nativeBuildingXml);
    return [`Buildings/house${i}.tbx`, file] as const;
  }));
  beforeEach(() => {
    previews = jasmine.createSpyObj('BuildingPreviewService', ['preview']);
    previews.preview.and.resolveTo({ blob: new Blob(['preview'], { type: 'image/png' }), width: 1, height: 1,
      bounds: { left: 0, top: 0, right: 1, bottom: 1 }, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: [] });
    TestBed.configureTestingModule({ imports: [TilezedBuildingPaletteComponent], providers: [{ provide: BuildingPreviewService, useValue: previews }] });
    fixture = TestBed.createComponent(TilezedBuildingPaletteComponent);
  });
  afterEach(() => fixture.destroy());

  it('shows previews for only the current page and lets users search and inspect a building before choosing it', async () => {
    fixture.componentRef.setInput('files', files(17));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.entries.length).toBe(8); expect(previews.preview).toHaveBeenCalledTimes(8);
    const choose = jasmine.createSpy('choose'); component.buildingChange.subscribe(choose);
    expect(choose).not.toHaveBeenCalled();
    const selected = component.entries[0]; component.select(selected); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.selected-preview img').getAttribute('src')).toBe(selected.url);
    expect(choose).toHaveBeenCalledOnceWith(selected.choice);
    component.filter('house16'); await fixture.whenStable(); fixture.detectChanges();
    expect(component.entries.map(entry => entry.path)).toEqual(['Buildings/house16.tbx']);
    expect(previews.preview).toHaveBeenCalledTimes(9);
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    fixture.destroy(); expect(revoke).toHaveBeenCalledWith(selected.url!);
  });

  it('isolates failed previews and disables selection when editing is unavailable', async () => {
    previews.preview.and.callFake(async file => {
      if (file.name === 'house0.tbx') throw new Error('Sheet unavailable');
      return { blob: new Blob(['preview']), width: 1, height: 1, bounds: { left: 0, top: 0, right: 1, bottom: 1 },
        squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, warnings: [] };
    });
    fixture.componentRef.setInput('files', files(2));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.entries[0].error).toBe('Sheet unavailable');
    expect(fixture.componentInstance.entries[1].url).toBeDefined();
    fixture.componentRef.setInput('disabled', true); fixture.detectChanges();
    const choose = jasmine.createSpy('choose'); fixture.componentInstance.buildingChange.subscribe(choose);
    fixture.componentInstance.select(fixture.componentInstance.entries[1]); expect(choose).not.toHaveBeenCalled();
  });
});
