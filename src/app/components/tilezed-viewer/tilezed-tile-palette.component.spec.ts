import { TestBed } from '@angular/core/testing';
import { TilezedTilePaletteComponent } from './tilezed-tile-palette.component';
import { TilezedAssetsService } from '../../services/tilezed-assets.service';
import { TileStamp } from '../../utils/tilezed-edit';

describe('TileZed stamp palette', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [TilezedTilePaletteComponent], providers: [
    { provide: TilezedAssetsService, useValue: { load: async () => ({ sheets: new Map(), errors: new Map(), warnings: [] }) } },
  ] }));
  it('selects a rectangular stamp by dragging on the continuous native sheet', async () => {
    const fixture = TestBed.createComponent(TilezedTilePaletteComponent);
    fixture.componentRef.setInput('tilesets', [{ name: 'ground', source: 'ground.png', firstGid: 1,
      tileWidth: 64, tileHeight: 128, imageWidth: 256, imageHeight: 256, columns: 4, rows: 2 }]);
    fixture.detectChanges(); await fixture.whenStable();
    let stamp!: TileStamp;
    fixture.componentInstance.stampChange.subscribe(value => stamp = value);
    const grid = fixture.nativeElement.querySelector('.sheet-grid') as HTMLElement;
    spyOn(grid, 'setPointerCapture');
    spyOn(grid, 'hasPointerCapture').and.returnValue(false);
    const rect = grid.getBoundingClientRect();
    grid.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 12, button: 0,
      clientX: rect.left + 48, clientY: rect.top + 32 }));
    expect(Array.from(stamp.gids)).toEqual([2]);
    grid.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 12,
      clientX: rect.left + 80, clientY: rect.top + 96 }));
    grid.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 12 }));
    expect(stamp.width).toBe(2); expect(stamp.height).toBe(2);
    expect(Array.from(stamp.gids)).toEqual([2,3,6,7]);
    fixture.componentRef.setInput('selectedGid', stamp.gids[0]); fixture.detectChanges();
    const selection = fixture.nativeElement.querySelector('.tile-selection') as HTMLElement;
    expect(selection.style.width).toBe('64px'); expect(selection.style.height).toBe('128px');
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    fixture.destroy();
  });
  it('reveals a picked tile anywhere in the sheet without emitting a new stamp', async () => {
    const fixture = TestBed.createComponent(TilezedTilePaletteComponent);
    fixture.nativeElement.style.cssText = 'width:470px;height:360px;position:fixed;inset:0';
    fixture.componentRef.setInput('tilesets', [{ name: 'large', source: 'large.png', firstGid: 1,
      tileWidth: 64, tileHeight: 128, imageWidth: 512, imageHeight: 4096, columns: 8, rows: 32 }]);
    const emit = spyOn(fixture.componentInstance.stampChange, 'emit');
    fixture.componentRef.setInput('selectedGid', 201);
    fixture.detectChanges(); await fixture.whenStable();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(fixture.componentInstance.selection).toEqual({ x: 0, y: 25, width: 1, height: 1 });
    expect(fixture.nativeElement.querySelector('.sheet-scroll').scrollTop).toBeGreaterThan(0);
    expect(emit).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('filters tileset names and changes preview zoom without changing the selected stamp', async () => {
    const fixture = TestBed.createComponent(TilezedTilePaletteComponent);
    fixture.componentRef.setInput('tilesets', ['ground', 'walls'].map((name, i) => ({ name, source: `${name}.png`, firstGid: 1 + i * 8,
      tileWidth: 64, tileHeight: 128, imageWidth: 256, imageHeight: 256, columns: 4, rows: 2 })));
    fixture.detectChanges(); await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'WALL'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
    const options = fixture.nativeElement.querySelectorAll('[role=option]') as NodeListOf<HTMLButtonElement>;
    expect(options.length).toBe(1); expect(options[0].textContent).toContain('walls');
    options[0].click(); fixture.detectChanges();
    expect(fixture.componentInstance.sheet!.name).toBe('walls');
    const emit = spyOn(fixture.componentInstance.stampChange, 'emit');
    fixture.componentInstance.setZoom(1); fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.sheet-grid') as HTMLElement).style.width).toBe('256px');
    expect(emit).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('shows all available advertising tiles when the map declares more rows than the PNG contains', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 1024;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    TestBed.overrideProvider(TilezedAssetsService, { useValue: { load: async () => ({ sheets: new Map([[1, blob]]), errors: new Map(), warnings: [] }) } });
    const fixture = TestBed.createComponent(TilezedTilePaletteComponent);
    fixture.componentRef.setInput('tilesets', [{ name: 'advertising_01', source: 'advertising_01.png', firstGid: 1,
      tileWidth: 64, tileHeight: 128, imageWidth: 512, imageHeight: 2048, columns: 8, rows: 16 }]);
    fixture.detectChanges(); await fixture.whenStable();
    // Native image decoding is not tracked by Angular's fixture stability.
    for (let attempt = 0; attempt < 50 && fixture.componentInstance.loading; attempt++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    fixture.detectChanges();
    expect(fixture.componentInstance.error).toBe('');
    expect(fixture.componentInstance.url).toMatch(/^blob:/);
    expect(fixture.componentInstance.rowCount).toBe(8);
    const grid = fixture.nativeElement.querySelector('.sheet-grid') as HTMLElement;
    expect(grid.style.height).toBe('512px');
    const emit = spyOn(fixture.componentInstance.stampChange, 'emit');
    fixture.componentInstance.choose(63);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(Array.from(emit.calls.mostRecent().args[0]!.gids)).toEqual([64]);
    fixture.componentInstance.choose(127);
    expect(emit).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
