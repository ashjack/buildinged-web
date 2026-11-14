import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { TileService } from '../../services/tile.service';
import { TilesetListWindowComponent } from './tileset-list-window.component';

describe('Tilesets popup availability', () => {
  let tiles: jasmine.SpyObj<TileService>;
  const names = ['PopupOptional', 'PopupHidden', 'PopupRequired'];
  beforeEach(() => {
    names.forEach(name => localStorage.removeItem(name));
    tiles = jasmine.createSpyObj<TileService>('TileService', ['processTilepacks', 'redownloadTilepack'], {
      tilepacks: [
        { name: 'Vanilla', url: 'vanilla.zip', enabled: false },
        { name: 'PopupOptional', url: 'optional.zip', enabled: false },
        { name: 'PopupHidden', url: 'hidden.zip', enabled: true, disabled: true },
        { name: 'PopupRequired', url: 'required.zip', enabled: false, required: true },
      ],
    });
    TestBed.configureTestingModule({
      imports: [CommonModule], declarations: [TilesetListWindowComponent],
      providers: [
        { provide: TileService, useValue: tiles },
        { provide: Store, useValue: { select: () => of(true), dispatch: () => {} } },
      ],
    });
  });
  afterEach(() => names.forEach(name => localStorage.removeItem(name)));

  it('hides disabled packs and locks required packs on even with a saved off setting', () => {
    localStorage.setItem('PopupHidden', '1');
    localStorage.setItem('PopupRequired', '0');
    const fixture = TestBed.createComponent(TilesetListWindowComponent);
    fixture.detectChanges();
    const rows = [...fixture.nativeElement.querySelectorAll('.tilepack-listing')] as HTMLElement[];
    expect(rows.map(row => row.querySelector('p')!.textContent)).toEqual(['Vanilla', 'PopupOptional', 'PopupRequired']);
    for (const row of [rows[0], rows[2]]) {
      const button = row.querySelector('button')!;
      expect(button.disabled).toBeTrue();
      expect(button.textContent).toBe('Required');
    }
    fixture.componentInstance.downloadPack('PopupRequired');
    fixture.componentInstance.downloadPack('PopupHidden', true);
    expect(tiles.processTilepacks).not.toHaveBeenCalled();
    expect(tiles.redownloadTilepack).not.toHaveBeenCalled();
  });

  it('enables, disables and re-enables optional packs without clearing their cache', () => {
    const fixture = TestBed.createComponent(TilesetListWindowComponent);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelectorAll('.tilepack-listing')[1] as HTMLElement;
    const [toggle, redownload] = Array.from(row.querySelectorAll('button'));
    toggle.click(); fixture.detectChanges();
    expect(localStorage.getItem('PopupOptional')).toBe('1');
    expect(toggle.textContent).toBe('Disable');
    expect(tiles.processTilepacks).toHaveBeenCalledTimes(1);
    toggle.click(); fixture.detectChanges();
    expect(localStorage.getItem('PopupOptional')).toBe('0');
    expect(toggle.textContent).toBe('Enable');
    expect(tiles.processTilepacks).toHaveBeenCalledTimes(1);
    toggle.click(); fixture.detectChanges();
    expect(tiles.processTilepacks).toHaveBeenCalledTimes(2);
    expect(tiles.redownloadTilepack).not.toHaveBeenCalled();
    redownload.click();
    expect(tiles.redownloadTilepack).toHaveBeenCalledTimes(1);
  });
});
