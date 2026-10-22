import { CommonModule } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { DbService } from '../../services/db.service';
import { CacheService } from '../../services/cache.service';
import { GridService } from '../../services/grid.service';
import { ToolSettingsService } from '../../services/tool-settings.service';
import { FurnitureSelectionMenuComponent } from '../furniture-selection-menu/furniture-selection-menu.component';
import { TileSelectionMenuComponent } from './tile-selection-menu.component';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
describe('Native tile mode docks', () => {
  let saved: string;
  let grid: GridService;
  let settings: ToolSettingsService;
  let dispatch: jasmine.Spy;
  beforeEach(() => {
    saved = JSON.stringify(localStorage); localStorage.clear();
    grid = new GridService({} as any, new CacheService());
    settings = new ToolSettingsService(); dispatch = jasmine.createSpy('dispatch');
    TestBed.configureTestingModule({ declarations: [TileSelectionMenuComponent], imports: [CommonModule, FormsModule],
      schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [
        { provide: GridService, useValue: grid }, { provide: ToolSettingsService, useValue: settings },
        { provide: Store, useValue: { dispatch } },
        { provide: DbService, useValue: {
          getTilesets: async () => [{ name: 'walls' }, { name: 'floors' }],
          getTiles: async (sheet: string) => [0, 2, 8, 10].map(i => ({ name: `${sheet}_${i.toString().padStart(3, '0')}.png`, url: image, tileset: sheet }))
        } }
      ] });
  });
  afterEach(() => { localStorage.clear(); Object.entries(JSON.parse(saved)).forEach(([key, value]) => localStorage.setItem(key, value as string)); });
  async function setup() {
    localStorage.setItem('selectedTileset', 'walls');
    const fixture = TestBed.createComponent(TileSelectionMenuComponent); fixture.detectChanges();
    for (let i = 0; i < 30 && !fixture.componentInstance.tiles.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    fixture.detectChanges(); return { fixture, dock: fixture.componentInstance, element: fixture.nativeElement as HTMLElement };
  }
  it('restores the sheet, keeps original tile coordinates and filters without leaving a hidden selection', async () => {
    const { fixture, dock, element } = await setup();
    expect(dock.tilesets).toEqual(['floors', 'walls']);
    expect(dock.selectedTileset).toBe('walls');
    expect(dock.tiles.length).toBe(16); expect(dock.tiles[1]).toBeUndefined();
    expect(dock.tiles[10]?.name).toBe('walls_010.png');
    expect(element.querySelectorAll('.tile-grid button').length).toBe(4);
    dock.searchTerm = 'floor'; dock.filterChanged(); expect(dock.selectedTileset).toBe('floors');
    dock.searchTerm = 'nothing'; dock.filterChanged(); fixture.detectChanges();
    expect(dock.selectedTileset).toBe(''); expect(dock.tiles).toEqual([]);
    fixture.destroy();
  });
  it('wires layer opacity, individual visibility and the native bottom-up visibility cutoff per floor', async () => {
    const { fixture, dock, element } = await setup();
    const checkbox = element.querySelector('[aria-label="Walls visible"]') as HTMLInputElement;
    checkbox.click(); fixture.detectChanges();
    expect(grid.layerView('Walls').visible).toBeFalse();
    dock.setSelectedLayer('Walls');
    const slider = element.querySelector('[aria-label="Layer opacity"]') as HTMLInputElement;
    slider.value = '35'; slider.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(grid.layerView('Walls').opacity).toBe(.35);
    dock.setVisibility(0);
    expect(grid.layerView('Floor').visible).toBeTrue(); expect(grid.layerView('FloorGrime').visible).toBeFalse();
    grid.setSelectedLevel(1); expect(dock.opacity).toBe(100); expect(grid.layerView('Walls').visible).toBeTrue();
    grid.setSelectedLevel(0); grid.beginRebuild(); grid.endRebuild(); expect(dock.opacity).toBe(35);
    grid.resetLayerViews(); expect(dock.opacity).toBe(100);
    expect(dispatch).toHaveBeenCalled(); fixture.destroy();
  });
  it('selects rectangular tile patterns in sheet coordinates and switches only to assigned default layers', async () => {
    const { fixture, dock } = await setup();
    dock.contextTile = 'walls_000.png'; dock.setDefaultLayer('WallOverlay');
    dock.selectTile(dock.tiles[0]!, 0, new MouseEvent('click'));
    expect(dock.getSelectedLayer()).toBe('WallOverlay');
    dock.selectTile(dock.tiles[10]!, 10, new MouseEvent('click', { shiftKey: true }));
    expect(settings.stamp).toEqual({ width: 3, height: 2, cells: [
      { x: 0, y: 0, tile: 'walls_000.png' }, { x: 2, y: 0, tile: 'walls_002.png' },
      { x: 0, y: 1, tile: 'walls_008.png' }, { x: 2, y: 1, tile: 'walls_010.png' }] });
    expect(settings.tileMode).toBe('brush');
    dock.toggleAutoSwitch(); dock.setSelectedLayer('Floor');
    dock.selectTile(dock.tiles[0]!, 0, new MouseEvent('click'));
    expect(dock.getSelectedLayer()).toBe('Floor'); expect(settings.stamp).toBeUndefined(); fixture.destroy();
  });
  it('uses the Furniture tab as a manual tile stamp without creating a furniture object or changing the current layer', () => {
    const component = new FurnitureSelectionMenuComponent({} as DomSanitizer, {} as DbService, {} as any, { dispatch } as any, settings);
    component.tileEditing = true; localStorage.setItem('selectedLayer', 'FloorFurniture');
    component.setSelectedFurniture({ entries: [{ orient: 'W', xSize: 2, ySize: 0, tiles: [
      { name: 'desk_000.png', url: image, x: 1, y: 0, layer: 'Furniture', level: 0 },
      { name: 'desk_001.png', url: image, x: 2, y: 0, layer: 'Furniture', level: 0 }] }] }, 'W');
    expect(settings.stamp?.cells).toEqual([{ x: 0, y: 0, tile: 'desk_000.png' }, { x: 1, y: 0, tile: 'desk_001.png' }]);
    expect(settings.tileMode).toBe('brush'); expect(dispatch).not.toHaveBeenCalled();
    expect(localStorage.getItem('selectedLayer')).toBe('FloorFurniture');
  });
});
