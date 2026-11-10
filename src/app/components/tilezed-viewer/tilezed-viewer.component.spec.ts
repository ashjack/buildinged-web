import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { DbService } from '../../services/db.service';
import { TilezedAssetsService } from '../../services/tilezed-assets.service';
import { TilezedHandoffService } from '../../services/tilezed-handoff.service';
import { TilezedStorageService } from '../../services/tilezed-storage.service';
import { TilezedSessionService } from '../../services/tilezed-session.service';
import { TilezedViewerComponent } from './tilezed-viewer.component';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { AuthService } from '../../services/auth.service';
import { TilezedBuildingContext } from '../../services/tilezed-handoff.service';
import { tilezedTileToPixel } from '../../utils/tilezed-overlays';
import { TilezedTilePaletteComponent } from './tilezed-tile-palette.component';
import { TilezedBuildingPaletteComponent } from './tilezed-building-palette.component';
import { ProjectApiService } from '../../services/project-api.service';
import { readTilezedMap } from '../../utils/tilezed-map';
import { nativeBuildingXml } from '../../testing/native-building.fixture';

const mapXml = `<map version="1.0" orientation="levelisometric" width="1" height="1" tilewidth="64" tileheight="32">
  <tileset firstgid="1" name="sheet_01" tilewidth="64" tileheight="128"><image source="sheet_01.png" width="64" height="128"/></tileset>
  <layer name="0_Floor" width="1" height="1"><data encoding="csv">1</data></layer>
</map>`;

describe('TileZed read-only viewer', () => {
  let fixture: ComponentFixture<TilezedViewerComponent>;
  let component: TilezedViewerComponent;
  let assets: jasmine.SpyObj<TilezedAssetsService>;
  let storage: jasmine.SpyObj<TilezedStorageService>;
  let changes: Subject<string[]>;

  beforeEach(async () => {
    localStorage.removeItem('tilezed:highlightCurrentLevel');
    localStorage.removeItem('tilezed:warningsExpanded');
    const previews = jasmine.createSpyObj('BuildingPreviewService', ['preview']);
    previews.preview.and.rejectWith(new Error('Preview unavailable'));
    assets = jasmine.createSpyObj<TilezedAssetsService>('TilezedAssetsService', ['load']);
    assets.load.and.callFake(async tilesets => ({
      sheets: new Map(),
      errors: new Map(tilesets.map(tileset => [tileset.firstGid, `${tileset.name}: sheet not found`])),
      warnings: [],
    }));
    storage = jasmine.createSpyObj<TilezedStorageService>('TilezedStorageService', ['lastMap', 'rememberMap', 'lastBuildings']);
    storage.lastMap.and.resolveTo(undefined);
    storage.rememberMap.and.resolveTo();
    storage.lastBuildings.and.resolveTo(undefined);
    changes = new Subject<string[]>();
    TestBed.configureTestingModule({
      declarations: [TilezedViewerComponent],
      imports: [CommonModule, RouterTestingModule, TilezedTilePaletteComponent, TilezedBuildingPaletteComponent],
      providers: [
        { provide: BuildingPreviewService, useValue: previews },
        { provide: AuthService, useValue: { isAdmin: false } },
        { provide: ProjectApiService, useValue: jasmine.createSpyObj('ProjectApiService', ['saveWorldMap']) },
        { provide: DbService, useValue: { sheetsChanged: changes } },
        { provide: TilezedAssetsService, useValue: assets },
        { provide: TilezedStorageService, useValue: storage },
        { provide: TilezedSessionService, useValue: jasmine.createSpyObj('TilezedSessionService', {
          restore: Promise.resolve(undefined), remember: undefined }) },
      ],
    });
    fixture = TestBed.createComponent(TilezedViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  afterEach(() => { fixture.destroy(); changes.complete(); localStorage.removeItem('tilezed:warningsExpanded'); localStorage.removeItem('tilezed:highlightCurrentLevel'); });

  it('toggles Highlight Current Level once per H press without switching tools, changing the document or adding a button', async () => {
    await openEditableMap(); component.setTool('stamp');
    const before = component.editor!.scene;
    const press = (options: KeyboardEventInit = {}) => component.canvas.nativeElement.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'h', bubbles: true, cancelable: true, ...options }));
    press(); fixture.detectChanges();
    expect(component.highlightCurrentLevel).toBeTrue(); expect(component.tool).toBe('stamp');
    expect(localStorage.getItem('tilezed:highlightCurrentLevel')).toBe('1');
    expect(component.editor!.scene).toBe(before); expect(component.dirty).toBeFalse(); expect(component.editor!.canUndo).toBeFalse();
    expect(fixture.nativeElement.querySelector('button[aria-label="Highlight Current Level"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="Pan"]').title).toBe('Pan');
    press({ repeat: true }); expect(component.highlightCurrentLevel).toBeTrue();
    const reopened = TestBed.createComponent(TilezedViewerComponent);
    expect(reopened.componentInstance.highlightCurrentLevel).toBeTrue(); reopened.destroy();
    press({ key: 'H' }); expect(component.highlightCurrentLevel).toBeFalse();
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', cancelable: true }));
    expect(component.highlightCurrentLevel).toBeTrue();
  });

  it('ignores H while typing, with browser modifiers, during composition and inside the layer dialog', async () => {
    await openEditableMap();
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag); fixture.nativeElement.appendChild(field);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
      expect(component.highlightCurrentLevel).toBeFalse(); field.remove();
    }
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      component.onKeyDown(new KeyboardEvent('keydown', { key: 'h', cancelable: true, ...modifier }));
      expect(component.highlightCurrentLevel).toBeFalse();
    }
    component.showAddLayer();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', cancelable: true }));
    expect(component.highlightCurrentLevel).toBeFalse(); component.closeAddLayer();
  });

  it('repaints cached building floors immediately when H is toggled', async () => {
    const atlas = document.createElement('canvas'); atlas.width = 128; atlas.height = 128;
    const fill = atlas.getContext('2d')!;
    fill.fillStyle = '#ff0000'; fill.fillRect(0, 0, 64, 128);
    fill.fillStyle = '#00ff00'; fill.fillRect(64, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => atlas.toBlob(value => resolve(value!), 'image/png'));
    const previews = TestBed.inject(BuildingPreviewService) as jasmine.SpyObj<BuildingPreviewService>;
    previews.preview.and.resolveTo({ blob, width: 64, height: 224, warnings: [],
      bounds: { left: -32, right: 32, top: -192, bottom: 32 }, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      composition: { pages: [{ blob, width: 128, height: 128 }], tiles: [
        { squareX: 0, squareY: 0, level: 0, layer: 'Floor', sheet: 'floor', index: 0, frame: 0 },
        { squareX: 0, squareY: 0, level: 1, layer: 'Roof', sheet: 'roof', index: 0, frame: 1 },
      ] } });
    await component.openMap(new File([mapXml], 'levels.tmx'), true, {
      lots: [{ x: 0, y: 0, width: 1, height: 1, level: 0, map: 'house.tbx' }],
      files: new Map([['house.tbx', new File([''], 'house.tbx')]]) });
    for (let i = 0; i < 50 && component.loadingBuildings; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const camera = (component as any).camera, viewport = (component as any).viewport, ratio = (component as any).pixelRatio;
    const color = () => [...component.canvas.nativeElement.getContext('2d')!.getImageData(
      Math.floor((viewport.width / 2 + (10 - camera.x) * camera.zoom) * ratio),
      Math.floor((viewport.height / 2 + (-80 - camera.y) * camera.zoom) * ratio), 1, 1).data];
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(color()).toEqual([0, 255, 0, 255]);
    component.canvas.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(color()).toEqual([255, 0, 0, 255]);
    component.canvas.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(color()).toEqual([0, 255, 0, 255]);
    expect(component.dirty).toBeFalse();
  });

  it('collapses stacked warnings into a counted row and remembers the show/hide preference', async () => {
    component.tileWarnings = ['One', 'Two'];
    component.sheetIssues = ['Missing sheet'];
    component.storageWarning = 'Storage unavailable';
    component.error = 'Save failed';
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.warning-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Show warnings');
    expect(toggle.textContent).toContain('4');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('#tilezed-warnings')).toBeNull();
    expect(fixture.nativeElement.querySelector('.message.error').textContent).toContain('Save failed');
    toggle.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#tilezed-warnings').textContent).toContain('Missing sheet');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('tilezed:warningsExpanded')).toBe('1');
    const reopened = TestBed.createComponent(TilezedViewerComponent);
    expect(reopened.componentInstance.warningsExpanded).toBeTrue();
    reopened.destroy();
    toggle.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#tilezed-warnings')).toBeNull();
    expect(localStorage.getItem('tilezed:warningsExpanded')).toBe('0');
  });

  async function openBuilding(projectId: string | null = 'project'): Promise<void> {
    const context: TilezedBuildingContext = { projectId: projectId ?? undefined,
      lots: [{ x: 0, y: 0, width: 1, height: 1, level: 0, map: 'Buildings\\house.tbx' }],
      files: new Map([['Buildings/house.tbx', new File(['<building/>'], 'house.tbx')]]) };
    Object.assign(TestBed.inject(AuthService), { isAdmin: true });
    component.showLotOutlines = true;
    await component.openMap(new File([mapXml], 'cell.tmx'), true, context);
    fixture.detectChanges();
  }

  function rightClickBuilding(): MouseEvent {
    const camera = (component as any).camera;
    const viewport = (component as any).viewport;
    const rect = component.canvas.nativeElement.getBoundingClientRect();
    const [x, y] = tilezedTileToPixel(component.scene!.map, 0.5, 0.5, 0);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: rect.left + viewport.width / 2 + (x - camera.x) * camera.zoom,
      clientY: rect.top + viewport.height / 2 + (y - 1 - camera.y) * camera.zoom });
    component.canvas.nativeElement.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('right-clicks the grey overlay without a rendered sprite and opens the direct shared building editor', async () => {
    await openBuilding();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const event = rightClickBuilding();
    expect(event.defaultPrevented).toBeTrue();
    const menu = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(2);
    const edit = menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(edit.textContent).toBe('Edit building');
    expect(document.activeElement).toBe(edit);
    edit.click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(navigate).toHaveBeenCalledOnceWith(['/projects', 'project', 'world-buildings', 'Buildings/house.tbx', 'edit']);
    expect(component.contextMenu).toBeUndefined();
    expect(component.dragging).toBeFalse();
  });

  it('opens task creation with the right-clicked building selected', async () => {
    await openBuilding();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    rightClickBuilding();
    const buttons = fixture.nativeElement.querySelectorAll('[role="menuitem"]') as NodeListOf<HTMLButtonElement>;
    expect(buttons[1].textContent).toBe('Create task from building');
    buttons[1].click(); await fixture.whenStable(); fixture.detectChanges();
    expect(navigate).toHaveBeenCalledOnceWith(['/projects', 'project', 'tasks', 'new'], {
      queryParams: { worldBuilding: 'Buildings/house.tbx' },
    });
    expect(component.contextMenu).toBeUndefined();
    expect(component.dragging).toBeFalse();
  });

  it('supports keyboard navigation between building context menu actions', async () => {
    await openBuilding(); rightClickBuilding();
    const buttons = fixture.nativeElement.querySelectorAll('[role="menuitem"]') as NodeListOf<HTMLButtonElement>;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('rechecks admin permissions before creating a task from the context menu', async () => {
    await openBuilding(); rightClickBuilding();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    await component.createTaskFromContextBuilding();
    expect(navigate).not.toHaveBeenCalled(); expect(component.contextMenu).toBeUndefined();
  });

  it('shows no editing menu for contributors, local maps, hidden overlays, or empty map space', async () => {
    await openBuilding();
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    rightClickBuilding();
    expect(component.contextMenu).toBeUndefined();
    Object.assign(TestBed.inject(AuthService), { isAdmin: true });
    component.showLotOutlines = false;
    rightClickBuilding();
    expect(component.contextMenu).toBeUndefined();
    component.showLotOutlines = true;
    component.onContextMenu(new MouseEvent('contextmenu', { clientX: -10000, clientY: -10000 }));
    expect(component.contextMenu).toBeUndefined();
    await openBuilding(null);
    rightClickBuilding();
    expect(component.contextMenu).toBeUndefined();
  });

  it('dismisses the menu on Escape, outside pointer down, zoom, and map changes', async () => {
    await openBuilding();
    rightClickBuilding();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.contextMenu).toBeUndefined();
    expect(document.activeElement).toBe(component.canvas.nativeElement);
    rightClickBuilding();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(component.contextMenu).toBeUndefined();
    rightClickBuilding();
    component.zoom(1.25);
    expect(component.contextMenu).toBeUndefined();
    rightClickBuilding();
    await component.openMap(new File([mapXml], 'other.tmx'));
    expect(component.contextMenu).toBeUndefined();
  });

  it('rechecks admin permissions when choosing Edit building', async () => {
    await openBuilding();
    rightClickBuilding();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    await component.editContextBuilding();
    expect(navigate).not.toHaveBeenCalled();
    expect(component.contextMenu).toBeUndefined();
  });

  it('keeps the context menu within the window when opened near the lower-right corner', async () => {
    await openBuilding();
    const viewport = (component as any).viewport;
    const [x, y] = tilezedTileToPixel(component.scene!.map, 0.5, 0.5, 0);
    (component as any).camera = { x: x - (viewport.width / 2 - 1), y: y - 1 - (viewport.height / 2 - 1), zoom: 1 };
    rightClickBuilding();
    const bounds = (fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement).getBoundingClientRect();
    expect(bounds.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  async function openEditableMap(hosted = false): Promise<void> {
    Object.assign(TestBed.inject(AuthService), { isAdmin: true });
    const editableXml = mapXml.replace('width="1" height="1"', 'width="4" height="1"')
      .replace('<layer name="0_Floor" width="1"', '<layer name="0_Floor" width="4"').replace('>1</data>', '>0,0,0,0</data>');
    await component.openMap(new File([editableXml], 'editable.tmx'), true, hosted
      ? { projectId: 'project', mapPath: 'maps/editable.tmx', worldRevision: 7, lots: [], files: new Map() } : undefined);
    fixture.detectChanges();
    const canvas = component.canvas.nativeElement;
    spyOn(canvas, 'setPointerCapture');
    spyOn(canvas, 'hasPointerCapture').and.returnValue(false);
    storage.rememberMap.calls.reset();
  }
  function pointerAt(type: string, x: number, y = 0, extra: PointerEventInit = {}): void {
    const camera = (component as any).camera, viewport = (component as any).viewport;
    const rect = component.canvas.nativeElement.getBoundingClientRect();
    const [px, py] = tilezedTileToPixel(component.scene!.map, x + 0.5, y + 0.5, 0);
    component.canvas.nativeElement.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 123,
      button: 0, clientX: rect.left + viewport.width / 2 + (px - camera.x) * camera.zoom,
      clientY: rect.top + viewport.height / 2 + (py - camera.y) * camera.zoom, ...extra }));
  }

  async function opaqueSheet(): Promise<Blob> {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 1024;
    canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  }

  async function prepareBuildingPlacement(hosted = false): Promise<void> {
    await openEditableMap(hosted);
    const file = new File([nativeBuildingXml], 'house.tbx');
    const context = (component as any).buildingContext as TilezedBuildingContext;
    context.files = new Map([['Buildings/house.tbx', file]]); context.cell = { x: 3, y: 4 };
    const previews = TestBed.inject(BuildingPreviewService).preview as jasmine.Spy;
    previews.and.resolveTo({ blob: await opaqueSheet(), width: 512, height: 1024, warnings: [],
      bounds: { left: 0, right: 64, top: -96, bottom: 32 }, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
    await component.chooseBuilding({ path: 'Buildings/house.tbx', file, width: 1, height: 1 });
    fixture.detectChanges(); await fixture.whenStable();
  }

  it('draws a building preview before placement, supports undo/redo, and saves WorldEd lots only on manual Save', async () => {
    await prepareBuildingPlacement(true);
    const draw = spyOn(component.canvas.nativeElement.getContext('2d')!, 'drawImage').and.callThrough();
    const bitmap = (component as any).buildingPreview.bitmap;
    pointerAt('pointermove', 1.1, 0.1);
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(draw.calls.allArgs().some(args => args[0] === bitmap)).toBeTrue();
    expect(component.dirty).toBeFalse(); expect(component.editor!.placedLots).toEqual([]);
    const save = TestBed.inject(ProjectApiService).saveWorldMap as jasmine.Spy;
    pointerAt('pointerdown', 1.1, 0.1); pointerAt('pointerup', 1.1, 0.1);
    expect(component.editor!.placedLots.length).toBe(1);
    const lot = { ...component.editor!.placedLots[0] };
    expect(component.dirty).toBeTrue(); expect(save).not.toHaveBeenCalled(); expect(storage.rememberMap).not.toHaveBeenCalled();
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0, 0, 0, 0]);
    component.history(); expect(component.editor!.placedLots).toEqual([]); expect(component.dirty).toBeFalse();
    component.history(true); expect(component.editor!.placedLots).toEqual([lot]);
    save.and.resolveTo({ projectId: 'project', path: 'maps/editable.tmx', revision: 8 });
    await component.saveMap();
    expect(save.calls.mostRecent().args[4]).toEqual({ cell: { x: 3, y: 4 }, lots: [lot] });
    expect((await readTilezedMap(save.calls.mostRecent().args[2])).lots).toEqual([]);
    expect(component.dirty).toBeFalse();
    component.history(); expect(component.dirty).toBeTrue();
    save.and.resolveTo({ projectId: 'project', path: 'maps/editable.tmx', revision: 9 });
    await component.saveMap();
    expect(save.calls.mostRecent().args[3]).toBe(8);
    expect(save.calls.mostRecent().args[4]).toEqual({ cell: { x: 3, y: 4 }, lots: [] });
  });

  it('exports local placements as TMX lot objects and cancels the brush without placing or saving', async () => {
    await prepareBuildingPlacement();
    pointerAt('pointermove', 1.1, 0.1);
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.tool).toBe('pan'); expect(component.dirty).toBeFalse();
    component.setTool('building'); pointerAt('pointerdown', 1.1, 0.1);
    const download = spyOn<any>(component, 'downloadMap');
    await component.saveMap();
    const file = download.calls.mostRecent().args[0] as File;
    expect((await readTilezedMap(await file.text())).lots).toEqual(component.editor!.placedLots);
    expect(storage.rememberMap).toHaveBeenCalled(); expect(component.dirty).toBeFalse();
  });

  it('preserves unsaved placements on save conflict and blocks placement after losing admin permissions', async () => {
    await prepareBuildingPlacement(true);
    pointerAt('pointerdown', 1.1, 0.1);
    const save = TestBed.inject(ProjectApiService).saveWorldMap as jasmine.Spy;
    save.and.rejectWith(new Error('The world changed in another session.'));
    await component.saveMap();
    expect(component.dirty).toBeTrue(); expect(component.editor!.placedLots.length).toBe(1);
    expect(component.error).toContain('world changed');
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    pointerAt('pointerdown', 2.1, 0.1);
    expect(component.editor!.placedLots.length).toBe(1);
  });

  it('adds a named tile layer at the top of the reversed list, supports undo, and saves only manually', async () => {
    await openEditableMap(true);
    const add = fixture.nativeElement.querySelector('button[aria-label="Add tile layer"]') as HTMLButtonElement;
    add.click(); fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('.layer-dialog') as HTMLDialogElement;
    const name = dialog.querySelector('input')!;
    expect(dialog.open).toBeTrue(); expect(name.value).toBe('Tile Layer 2');
    name.value = 'Fences'; name.dispatchEvent(new Event('input'));
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(dialog.open).toBeFalse(); expect(component.activeLayer).toBe('0_Fences');
    const layerNames = () => Array.from(fixture.nativeElement.querySelectorAll('select[aria-label="Active tile layer"] option') as NodeListOf<HTMLOptionElement>).map(option => option.value);
    expect(layerNames()).toEqual(['0_Fences', '0_Floor']);
    expect(component.scene!.map.layers.map(layer => layer.name)).toEqual(['0_Floor', '0_Fences']);
    expect(component.dirty).toBeTrue();
    component.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(1) });
    pointerAt('pointerdown', 1); pointerAt('pointerup', 1);
    expect(component.scene!.layers[0].gids[1]).toBe(0);
    expect(component.scene!.layers[1].gids[1]).toBe(1);
    component.history(); component.history(); fixture.detectChanges();
    expect(layerNames()).toEqual(['0_Floor']); expect(component.activeLayer).toBe('0_Floor');
    expect(component.dirty).toBeFalse();
    component.history(true); component.history(true); fixture.detectChanges();
    expect(layerNames()).toEqual(['0_Fences', '0_Floor']); expect(component.activeLayer).toBe('0_Fences');
    const save = TestBed.inject(ProjectApiService).saveWorldMap as jasmine.Spy;
    expect(save).not.toHaveBeenCalled(); expect(storage.rememberMap).not.toHaveBeenCalled();
    save.and.resolveTo({ projectId: 'project', path: 'maps/editable.tmx', revision: 8 });
    await component.saveMap();
    const saved = await readTilezedMap(save.calls.mostRecent().args[2]);
    expect(saved.layers.map(layer => layer.name)).toEqual(['0_Floor', '0_Fences']);
    expect(saved.layers[1].gids[1]).toBe(1); expect(component.dirty).toBeFalse();
  });

  it('raises and lowers the selected layer, keeps it selected through undo, and persists the order only on Save', async () => {
    await openEditableMap(true);
    component.newLayerName = 'Detail'; component.addLayer(); fixture.detectChanges();
    const button = (label: string) => fixture.nativeElement.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    const order = () => component.scene!.map.layers.map(layer => layer.name);
    expect(button('Raise layer').disabled).toBeTrue(); expect(button('Lower layer').disabled).toBeFalse();
    button('Lower layer').click(); fixture.detectChanges();
    expect(order()).toEqual(['0_Detail', '0_Floor']); expect(component.activeLayer).toBe('0_Detail');
    expect(component.scene!.layers.map(layer => layer.name)).toEqual(order());
    expect(component.layerOptions.map(layer => layer.name)).toEqual(['0_Floor', '0_Detail']);
    expect(button('Lower layer').disabled).toBeTrue(); expect(button('Raise layer').disabled).toBeFalse();
    component.history(); fixture.detectChanges(); expect(order()).toEqual(['0_Floor', '0_Detail']);
    expect(component.activeLayer).toBe('0_Detail');
    component.history(true); fixture.detectChanges(); expect(order()).toEqual(['0_Detail', '0_Floor']);
    const save = TestBed.inject(ProjectApiService).saveWorldMap as jasmine.Spy;
    expect(save).not.toHaveBeenCalled(); expect(storage.rememberMap).not.toHaveBeenCalled();
    save.and.resolveTo({ projectId: 'project', path: 'maps/editable.tmx', revision: 8 });
    await component.saveMap();
    expect((await readTilezedMap(save.calls.mostRecent().args[2])).layers.map(layer => layer.name)).toEqual(['0_Detail', '0_Floor']);
    expect(component.dirty).toBeFalse();
    button('Raise layer').click(); fixture.detectChanges();
    expect(order()).toEqual(['0_Floor', '0_Detail']); expect(component.dirty).toBeTrue();
  });

  it('blocks layer moves while saving, after an account change, and for non-admins', async () => {
    await openEditableMap(); component.newLayerName = 'Detail'; component.addLayer();
    const order = () => component.scene!.map.layers.map(layer => layer.name);
    component.saving = true; component.moveLayer('down'); expect(order()).toEqual(['0_Floor', '0_Detail']);
    component.saving = false;
    const auth = TestBed.inject(AuthService); Object.assign(auth, { user: { uid: 'different-user' } });
    component.moveLayer('down'); expect(order()).toEqual(['0_Floor', '0_Detail']);
    Object.assign(auth, { isAdmin: false }); component.moveLayer('down');
    expect(order()).toEqual(['0_Floor', '0_Detail']);
  });

  it('keeps duplicate-name errors inside the layer dialog and lets cancellation leave the map unchanged', async () => {
    await openEditableMap();
    component.showAddLayer(); component.newLayerName = '0_Floor'; component.addLayer(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.layer-dialog').open).toBeTrue();
    expect(fixture.nativeElement.querySelector('.layer-error').textContent).toContain('already has that name');
    expect(component.dirty).toBeFalse();
    component.closeAddLayer();
    expect(fixture.nativeElement.querySelector('.layer-dialog').open).toBeFalse();
    expect(component.scene!.map.layers.length).toBe(1);
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    component.newLayerName = 'Forbidden'; component.addLayer();
    expect(component.scene!.map.layers.length).toBe(1);
    expect(storage.rememberMap).not.toHaveBeenCalled();
  });

  it('shows tool icons with accessible names and shortcut tooltips', async () => {
    await openEditableMap();
    const button = fixture.nativeElement.querySelector('button[aria-label="Draw fence"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('');
    expect(button.title).toBe('Draw fence (G)');
    expect(button.querySelector('img')?.getAttribute('src')).toBe('assets/tilezed-tools/fence-tool.svg');
  });

  it('picks the opaque tile under the actual cursor above the map diamond', async () => {
    await openEditableMap();
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 128);
    const bitmap = await createImageBitmap(canvas);
    (component as any).images.set(1, { bitmap, layout: { tileWidth: 64, tileHeight: 128 } });
    component.scene!.layers[0].gids[0] = 1;
    component.setTool('pick');
    const camera = (component as any).camera, viewport = (component as any).viewport, rect = component.canvas.nativeElement.getBoundingClientRect();
    await component.pickAtEvent(new MouseEvent('pointerdown', {
      clientX: rect.left + viewport.width / 2 + (10 - camera.x) * camera.zoom,
      clientY: rect.top + viewport.height / 2 + (-50 - camera.y) * camera.zoom,
    }));
    expect(component.tool).toBe('stamp'); expect(component.stamp.gids[0]).toBe(1);
    expect(component.dirty).toBeFalse();
  });

  it('imports a picked building tile into this map without saving or copying building pixels into the grid', async () => {
    await openEditableMap();
    const blob = await opaqueSheet();
    assets.load.and.callFake(async sheets => ({ sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), errors: new Map(), warnings: [] }));
    spyOn(component.buildings!, 'pickTile').and.resolveTo({ sheet: 'building_floor_01', index: 9 });
    const bitmap = await createImageBitmap(blob);
    component.buildings!.sprites.push({ bitmap, level: 0, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      bounds: { left: -10000, right: 10000, top: -10000, bottom: 10000 } });
    component.setTool('pick');
    await component.pickAtEvent(new MouseEvent('pointerdown'));
    expect(component.tool).toBe('stamp');
    expect(component.scene!.map.tilesets.at(-1)?.name).toBe('building_floor_01');
    expect(component.stamp.gids[0]).toBe(11);
    expect(component.dirty).toBeFalse();
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0, 0, 0, 0]);
    pointerAt('pointerdown', 0); pointerAt('pointerup', 0);
    const saved = await readTilezedMap(await component.editor!.serialize());
    expect(saved.layers[0].gids[0]).toBe(11);
    expect(saved.tilesets[1].name).toBe('building_floor_01');
    expect(storage.rememberMap).not.toHaveBeenCalled();
    bitmap.close();
  });

  it('renders AboveLots over buildings and picks it before lots while transparent pixels reveal the building', async () => {
    await openEditableMap();
    const source = document.createElement('canvas'); source.width = 64; source.height = 128;
    const context = source.getContext('2d')!;
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 32, 128);
    const tile = await createImageBitmap(source);
    context.fillStyle = '#00ff00'; context.fillRect(0, 0, 64, 128);
    const building = await createImageBitmap(source);
    const name = component.editor!.addLayer('AboveLots');
    component.editor!.paintCells(name, [{ point: { x: 0, y: 0 }, gid: 1 }]);
    component.scene = { ...component.editor!.scene };
    component.scene.usedSheets = [{ tileset: component.scene.map.tilesets[0], maxIndex: 0 }];
    (component as any).images.set(1, { bitmap: tile, layout: { tileWidth: 64, tileHeight: 128 } });
    component.buildings!.sprites.push({ bitmap: building, bounds: { left: 0, top: -96, right: 64, bottom: 32 },
      level: 0, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
    const pickBuilding = spyOn(component.buildings!, 'pickTile').and.resolveTo({ sheet: 'sheet_01', index: 0 });
    const canvas = component.canvas.nativeElement;
    const screenPoint = (x: number) => {
      const camera = (component as any).camera, viewport = (component as any).viewport;
      return { x: viewport.width / 2 + (x - camera.x) * camera.zoom, y: viewport.height / 2 + (-32 - camera.y) * camera.zoom };
    };
    const eventAt = (x: number) => {
      const point = screenPoint(x), rect = canvas.getBoundingClientRect();
      return new MouseEvent('pointerdown', { clientX: rect.left + point.x, clientY: rect.top + point.y });
    };
    const colorAt = (x: number) => {
      const point = screenPoint(x), ratio = (component as any).pixelRatio;
      return [...canvas.getContext('2d')!.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data];
    };
    try {
      component.setTool('pan');
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(colorAt(16)).toEqual([255, 0, 0, 255]);
      expect(colorAt(48)).toEqual([0, 255, 0, 255]);
      component.setTool('pick'); await component.pickAtEvent(eventAt(16));
      expect(pickBuilding).not.toHaveBeenCalled(); expect(component.activeLayer).toBe('0_AboveLots');
      component.selectLayer('0_Floor'); component.setTool('pick'); await component.pickAtEvent(eventAt(48));
      expect(pickBuilding).toHaveBeenCalledTimes(1); expect(component.activeLayer).toBe('0_Floor');
      component.scene.layers.find(layer => layer.name === name)!.visible = false;
      component.scene = { ...component.scene }; component.setTool('pan');
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(colorAt(16)).toEqual([0, 255, 0, 255]);
    } finally { building.close(); }
  });

  it('renders a farther AboveLots fence behind a nearer building wall using the cached square compositor', async () => {
    Object.assign(TestBed.inject(AuthService), { isAdmin: true });
    const source = document.createElement('canvas'); source.width = 64; source.height = 128;
    const context = source.getContext('2d')!; context.fillStyle = '#00ff00'; context.fillRect(0, 0, 64, 128);
    const wall = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!), 'image/png'));
    context.fillStyle = '#0000ff'; context.fillRect(0, 0, 64, 128);
    const fence = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.resolveTo({ sheets: new Map([[1, fence]]), errors: new Map(), warnings: [] });
    const previews = TestBed.inject(BuildingPreviewService) as jasmine.SpyObj<BuildingPreviewService>;
    previews.preview.and.resolveTo({ blob: wall, width: 64, height: 128, warnings: [],
      bounds: { left: -32, right: 32, top: -96, bottom: 32 }, squares: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      composition: { pages: [{ blob: wall, width: 64, height: 128 }], tiles: [
        { squareX: 0, squareY: 0, level: 0, layer: 'Walls', frame: 0, sheet: 'sheet_01', index: 0 },
      ] } });
    const xml = mapXml.replace('width="1" height="1"', 'width="2" height="1"')
      .replace('<layer name="0_Floor" width="1"', '<layer name="0_Floor" width="2"').replace('>1</data>', '>0,0</data>')
      .replace('</map>', '<layer name="0_AboveLots" width="2" height="1"><data encoding="csv">1,0</data></layer></map>');
    await component.openMap(new File([xml], 'depth.tmx'), true, {
      lots: [{ x: 1, y: 0, width: 1, height: 1, level: 0, map: 'house.tbx' }], files: new Map([['house.tbx', new File([''], 'house.tbx')]]) });
    for (let i = 0; i < 50 && component.loadingBuildings; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(component.buildings!.sprites[0].composition).toBeDefined();
    component.setTool('pan'); await new Promise(resolve => requestAnimationFrame(resolve));
    const camera = (component as any).camera, viewport = (component as any).viewport, ratio = (component as any).pixelRatio;
    const x = viewport.width / 2 + (40 - camera.x) * camera.zoom, y = viewport.height / 2 + (-40 - camera.y) * camera.zoom;
    const color = component.canvas.nativeElement.getContext('2d')!.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1).data;
    expect([...color]).toEqual([0, 255, 0, 255]);
    component.setTool('pick');
    const rect = component.canvas.nativeElement.getBoundingClientRect();
    await component.pickAtEvent(new MouseEvent('pointerdown', { clientX: rect.left + x, clientY: rect.top + y }));
    expect(component.tool).toBe('stamp'); expect(component.activeLayer).toBe('0_Floor');
  });

  it('previews native fences, commits a drag on release, supports gates/posts, and leaves saving manual', async () => {
    await openEditableMap(true);
    const blob = await opaqueSheet();
    assets.load.and.callFake(async sheets => ({ sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), errors: new Map(), warnings: [] }));
    component.tool = 'fence'; await component.prepareFence();
    pointerAt('pointerdown', 0); pointerAt('pointermove', 3);
    expect(component.dirty).toBeFalse();
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0, 0, 0, 0]);
    pointerAt('pointerup', 3);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([34, 35, 34, 35]);
    pointerAt('pointerdown', 0, 0, { altKey: true });
    expect(component.scene!.layers[0].gids[0]).toBe(41); // Native north gate space.
    component.history(); component.history();
    expect(component.dirty).toBeFalse();
    pointerAt('pointerdown', 0, 0, { ctrlKey: true });
    expect(component.scene!.layers[0].gids[0]).toBe(39);
    pointerAt('pointerdown', 0, 0, { ctrlKey: true });
    expect(component.scene!.layers[0].gids[0]).toBe(0);
    pointerAt('pointerdown', 0); pointerAt('pointermove', 3); pointerAt('pointercancel', 3);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0, 0, 0, 0]);
    expect(storage.rememberMap).not.toHaveBeenCalled();
    expect(TestBed.inject(ProjectApiService).saveWorldMap).not.toHaveBeenCalled();
  });

  it('joins a corner at an alternating fence endpoint and preserves earlier segments through undo and retracing', async () => {
    await openEditableMap(true);
    const blob = await opaqueSheet();
    assets.load.and.callFake(async sheets => ({ sheets: new Map(sheets.map(sheet => [sheet.firstGid, blob])), errors: new Map(), warnings: [] }));
    component.tool = 'fence'; await component.prepareFence();
    pointerAt('pointerdown', 0); pointerAt('pointermove', 3); pointerAt('pointerup', 3);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([34, 35, 34, 35]);
    // A perpendicular edge at the final North2 section must become a corner.
    pointerAt('pointerdown', 3); pointerAt('pointerup', 3);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([34, 35, 34, 38]);
    const joined = await component.editor!.serialize();
    expect(Array.from((await readTilezedMap(joined)).layers[0].gids)).toEqual([34, 35, 34, 38]);
    // Reversing over the whole run must retain its alternation and its corner.
    pointerAt('pointerdown', 3); pointerAt('pointermove', 0); pointerAt('pointerup', 0);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([34, 35, 34, 38]);
    component.history();
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([34, 35, 34, 35]);
    component.history(true);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([34, 35, 34, 38]);
    expect(storage.rememberMap).not.toHaveBeenCalled();
    expect(TestBed.inject(ProjectApiService).saveWorldMap).not.toHaveBeenCalled();
  });

  it('paints a continuous stamp stroke with undo and does not save automatically', async () => {
    await openEditableMap();
    component.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(1) });
    pointerAt('pointerdown', 0); pointerAt('pointermove', 3); pointerAt('pointerup', 3);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([1,1,1,1]);
    expect(component.dirty).toBeTrue();
    expect(storage.rememberMap).not.toHaveBeenCalled();
    expect(TestBed.inject(ProjectApiService).saveWorldMap).not.toHaveBeenCalled();
    component.history();
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0,0,0,0]);
    expect(component.dirty).toBeFalse();
    component.history(true);
    expect(component.dirty).toBeTrue();
  });

  it('loads an unused stamp sheet and previews it on hover without editing or saving the map', async () => {
    await openEditableMap();
    const sheet = document.createElement('canvas'); sheet.width = 64; sheet.height = 128;
    sheet.getContext('2d')!.fillStyle = '#ff0000'; sheet.getContext('2d')!.fillRect(0, 0, 64, 128);
    const blob = await new Promise<Blob>(resolve => sheet.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.resolveTo({ sheets: new Map([[1, blob]]), errors: new Map(), warnings: [] });
    component.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(1) });
    for (let attempt = 0; attempt < 50 && !(component as any).images.has(1); attempt++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    expect((component as any).images.has(1)).toBeTrue();
    const bitmap = (component as any).images.get(1).bitmap;
    const context = component.canvas.nativeElement.getContext('2d')!;
    const draw = spyOn(context, 'drawImage').and.callThrough();
    pointerAt('pointermove', 1);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(draw.calls.allArgs().some(args => args[0] === bitmap)).toBeTrue();
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0,0,0,0]);
    expect(component.dirty).toBeFalse();
    expect(component.editor!.canUndo).toBeFalse();
    expect(storage.rememberMap).not.toHaveBeenCalled();
    expect(TestBed.inject(ProjectApiService).saveWorldMap).not.toHaveBeenCalled();
    draw.calls.reset();
    component.canvas.nativeElement.dispatchEvent(new PointerEvent('pointerleave'));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(draw.calls.allArgs().some(args => args[0] === bitmap)).toBeFalse();
  });

  it('selects a rectangle, limits bucket fill to that selection, picks a tile, and erases on the active layer', async () => {
    await openEditableMap();
    component.setTool('select'); pointerAt('pointerdown', 1); pointerAt('pointermove', 2); pointerAt('pointerup', 2);
    expect(component.editor!.selection).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    component.stamp = { width: 1, height: 1, gids: Uint32Array.of(1) };
    component.setTool('bucket'); pointerAt('pointerdown', 1);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0,1,1,0]);
    component.setTool('pick'); pointerAt('pointerdown', 1);
    await new Promise(resolve => setTimeout(resolve));
    expect(component.stamp.gids[0]).toBe(1);
    expect(component.tool).toBe('pick'); // The test pack has no image pixels to pick.
    component.setTool('eraser'); pointerAt('pointerdown', 1); pointerAt('pointerup', 1);
    expect(Array.from(component.scene!.layers[0].gids)).toEqual([0,0,1,0]);
    expect(storage.rememberMap).not.toHaveBeenCalled();
  });

  it('publishes a hosted map only when Save is requested and keeps failed saves dirty', async () => {
    await openEditableMap(true);
    component.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(1) });
    pointerAt('pointerdown', 0); pointerAt('pointerup', 0);
    const save = TestBed.inject(ProjectApiService).saveWorldMap as jasmine.Spy;
    expect(save).not.toHaveBeenCalled();
    save.and.rejectWith(new Error('Revision conflict'));
    await component.saveMap();
    expect(component.dirty).toBeTrue();
    expect(component.error).toContain('Revision conflict');
    expect(storage.rememberMap).not.toHaveBeenCalled();
    save.and.resolveTo({ projectId: 'project', path: 'maps/editable.tmx', revision: 8 });
    await component.saveMap();
    const args = save.calls.mostRecent().args;
    expect(args[0]).toBe('project'); expect(args[1]).toBe('maps/editable.tmx'); expect(args[3]).toBe(7);
    expect((await readTilezedMap(args[2])).layers[0].gids[0]).toBe(1);
    expect(component.dirty).toBeFalse();
    pointerAt('pointerdown', 1); pointerAt('pointerup', 1);
    await component.saveMap();
    expect(save.calls.mostRecent().args[3]).toBe(8);
  });

  it('downloads and remembers local edits only on manual Save', async () => {
    await openEditableMap();
    component.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(1) });
    pointerAt('pointerdown', 0); pointerAt('pointerup', 0);
    const download = spyOn(HTMLAnchorElement.prototype, 'click');
    expect(storage.rememberMap).not.toHaveBeenCalled();
    await component.saveMap();
    expect(download).toHaveBeenCalledTimes(1);
    expect(storage.rememberMap).toHaveBeenCalledTimes(1);
    expect((await readTilezedMap(await storage.rememberMap.calls.mostRecent().args[0].text())).layers[0].gids[0]).toBe(1);
    expect(component.dirty).toBeFalse();
  });

  it('prompts before replacing or leaving an unsaved map and blocks contributors from editing or saving', async () => {
    await openEditableMap();
    component.chooseStamp({ width: 1, height: 1, gids: Uint32Array.of(1) });
    pointerAt('pointerdown', 0); pointerAt('pointerup', 0);
    spyOn(window, 'confirm').and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    await component.openMap(new File([mapXml], 'other.tmx'));
    expect(component.fileName).toBe('editable.tmx');
    const event = new Event('beforeunload', { cancelable: true });
    component.beforeUnload(event as BeforeUnloadEvent);
    expect(event.defaultPrevented).toBeTrue();
    Object.assign(TestBed.inject(AuthService), { isAdmin: false });
    expect(component.canEdit).toBeFalse();
    await component.saveMap();
    expect(TestBed.inject(ProjectApiService).saveWorldMap).not.toHaveBeenCalled();
    expect(storage.rememberMap).not.toHaveBeenCalled();
  });

  it('opens a map, reports missing sheets, and loads a selected 1x folder without changing the map', async () => {
    const file = new File([mapXml], 'map.tmx');
    await component.openMap(file);
    expect(component.fileName).toBe('map.tmx');
    expect(component.scene?.layers[0].gids[0]).toBe(1);
    expect(component.sheetIssues).toEqual(['sheet_01: sheet not found']);

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = 64; sheetCanvas.height = 128;
    const blob = await new Promise<Blob>(resolve => sheetCanvas.toBlob(value => resolve(value!), 'image/png'));
    const bitmap = await createImageBitmap(blob);
    const close = spyOn(bitmap, 'close').and.callThrough();
    spyOn(window, 'createImageBitmap').and.resolveTo(bitmap);
    const sheet = new File([blob], 'sheet_01.png', { type: 'image/png' });
    Object.defineProperty(sheet, 'webkitRelativePath', { value: 'Tiles/sheet_01.png' });
    const transfer = new DataTransfer();
    transfer.items.add(sheet);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[accept=".png,image/png"]');
    input.files = transfer.files;
    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: input });
    await component.onTilesSelected(event);
    expect(component.folderName).toBe('Tiles');
    expect(component.sheetIssues).toEqual([]);
    expect(assets.load).toHaveBeenCalledTimes(1);
    expect(storage.rememberMap).toHaveBeenCalledWith(file);
    expect(await file.text()).toBe(mapXml);
    fixture.destroy();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing map when a new file is invalid', async () => {
    await component.openMap(new File([mapXml], 'valid.tmx'));
    const previous = component.scene;
    await component.openMap(new File(['<map>'], 'broken.tmx'));
    expect(component.scene).toBe(previous);
    expect(component.fileName).toBe('valid.tmx');
    expect(component.error).toContain('valid XML');
    expect(storage.rememberMap).toHaveBeenCalledTimes(1);
  });

  it('ignores an older map load that completes after a newer one', async () => {
    const slow = new File([mapXml], 'slow.tmx');
    let finish!: (value: string) => void;
    spyOn(slow, 'text').and.returnValue(new Promise(resolve => finish = resolve));
    const first = component.openMap(slow);
    await component.openMap(new File([mapXml], 'newer.tmx'));
    finish(mapXml);
    await first;
    expect(component.fileName).toBe('newer.tmx');
    expect(component.loadingMap).toBeFalse();
    expect(storage.rememberMap).toHaveBeenCalledTimes(1);
    expect(storage.rememberMap.calls.mostRecent().args[0].name).toBe('newer.tmx');
  });

  it('surfaces image decoding errors so a different Tiles folder can be chosen', async () => {
    assets.load.and.resolveTo({ sheets: new Map([[1, new Blob(['not a PNG'])]]), errors: new Map(), warnings: [] });
    spyOn(window, 'createImageBitmap').and.rejectWith(new Error('Invalid PNG'));
    await component.openMap(new File([mapXml], 'map.tmx'));
    expect(component.sheetIssues).toEqual(['sheet_01: Invalid PNG']);
  });

  it('retains a partial sheet and reports only missing tile references instead of dropping every tile', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.resolveTo({ sheets: new Map([[1, blob]]), errors: new Map(), warnings: [] });
    const xml = mapXml.replace('width="1" height="1"', 'width="2" height="1"')
      .replace('width="64" height="128"', 'width="128" height="256"')
      .replace('<layer name="0_Floor" width="1"', '<layer name="0_Floor" width="2"').replace('>1</data>', '>1,3</data>');
    await component.openMap(new File([xml], 'partial.tmx'));
    expect((component as any).images.size).toBe(1);
    expect(component.sheetIssues.length).toBe(1);
    expect(component.sheetIssues[0]).toContain('1 referenced tile(s)');
    expect(component.sheetIssues[0]).toContain('(2)');
    expect(component.sheetIssues[0]).toContain('Available tiles are still shown');
  });

  it('uses automatically resolved tiles without selecting a folder', async () => {
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = 64; sheetCanvas.height = 128;
    const blob = await new Promise<Blob>(resolve => sheetCanvas.toBlob(value => resolve(value!), 'image/png'));
    assets.load.and.resolveTo({ sheets: new Map([[1, blob]]), errors: new Map(), warnings: [] });

    await component.openMap(new File([mapXml], 'map.tmx'));

    expect(component.sheetIssues).toEqual([]);
    expect(component.folderName).toBe('');
    expect(assets.load.calls.mostRecent().args[0][0].name).toBe('sheet_01');
  });

  it('reopens the last map without saving it again', async () => {
    storage.lastMap.and.resolveTo(new File([mapXml], 'remembered.tmx'));
    const restored = TestBed.createComponent(TilezedViewerComponent);
    restored.detectChanges();
    await restored.whenStable();
    for (let i = 0; i < 50 && !restored.componentInstance.scene; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    expect(restored.componentInstance.fileName).toBe('remembered.tmx');
    expect(restored.componentInstance.restoredMap).toBeTrue();
    expect(storage.rememberMap).not.toHaveBeenCalled();
    restored.destroy();
  });

  it('restores the last hosted cell before considering an older local map', async () => {
    const sessions = TestBed.inject(TilezedSessionService) as jasmine.SpyObj<TilezedSessionService>;
    const file = new File([mapXml], 'last-project-cell.tmx');
    const buildings = { projectId: 'project', mapPath: 'maps/last-project-cell.tmx', worldRevision: 9,
      cell: { x: 4, y: 5 }, lots: [], files: new Map<string, File>() };
    sessions.restore.and.resolveTo({ file, buildings });
    storage.lastMap.and.resolveTo(new File([mapXml], 'older-local-map.tmx')); storage.lastMap.calls.reset();
    const restored = TestBed.createComponent(TilezedViewerComponent); restored.detectChanges();
    await restored.whenStable();
    for (let i = 0; i < 50 && !restored.componentInstance.scene; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(restored.componentInstance.fileName).toBe(file.name);
    expect(restored.componentInstance.worldLink).toEqual(['/worlded/project', 'project']);
    expect(restored.componentInstance.hostedMap).toBeTrue(); expect(restored.componentInstance.restoredMap).toBeTrue();
    expect(storage.lastMap).not.toHaveBeenCalled(); expect(storage.rememberMap).not.toHaveBeenCalled();
    restored.destroy();
  });

  it('reports a denied hosted restore without reopening an unrelated older local map', async () => {
    const sessions = TestBed.inject(TilezedSessionService) as jasmine.SpyObj<TilezedSessionService>;
    sessions.restore.and.rejectWith(new Error('Project access removed.'));
    storage.lastMap.and.resolveTo(new File([mapXml], 'older-local-map.tmx')); storage.lastMap.calls.reset();
    const restored = TestBed.createComponent(TilezedViewerComponent); restored.detectChanges(); await restored.whenStable();
    for (let i = 0; i < 50 && !restored.componentInstance.storageWarning; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(restored.componentInstance.scene).toBeUndefined();
    expect(restored.componentInstance.storageWarning).toContain('Project access removed.');
    expect(storage.lastMap).not.toHaveBeenCalled(); restored.destroy();
  });

  it('opens a WorldEd cell instead of restoring the previous map', async () => {
    const file = new File([mapXml], 'cell.tmx');
    TestBed.inject(TilezedHandoffService).send(file);
    storage.lastMap.calls.reset();
    const opened = TestBed.createComponent(TilezedViewerComponent);
    opened.detectChanges();
    for (let i = 0; i < 50 && !opened.componentInstance.scene; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    expect(opened.componentInstance.fileName).toBe('cell.tmx');
    expect(opened.componentInstance.restoredMap).toBeFalse();
    expect(storage.rememberMap).toHaveBeenCalledWith(file);
    expect(storage.lastMap).not.toHaveBeenCalled();
    opened.destroy();
  });

  it('keeps WorldEd lot placements when the TMX itself has no lots', async () => {
    const file = new File([mapXml], 'cell.tmx');
    const buildings = { lots: [{ x: 1, y: 2, width: 3, height: 4, level: 0, map: 'missing.tbx' }],
      files: new Map<string, File>() };
    await component.openMap(file, true, buildings);
    expect(storage.rememberMap).toHaveBeenCalledWith(file, buildings);
    expect([...component.buildings!.warnings].join(' ')).toContain('missing.tbx');
  });

  it('returns hosted cells to their project world without saving private files as a local map', async () => {
    const file = new File([mapXml], 'cell.tmx');
    await component.openMap(file, true, { projectId: 'shared-project', lots: [], files: new Map() });
    expect(component.worldLink).toEqual(['/worlded/project', 'shared-project']);
    expect(storage.rememberMap).not.toHaveBeenCalled();
    expect(component.restoredMap).toBeFalse();
  });

  it('remembers the hosted project, path and exact cell when opened from WorldEd', async () => {
    const file = new File([mapXml], 'cell.tmx');
    const buildings = { projectId: 'shared-project', mapPath: 'maps/cell.tmx', worldRevision: 5,
      cell: { x: 4, y: 7 }, lots: [], files: new Map<string, File>() };
    await component.openMap(file, true, buildings);
    expect(TestBed.inject(TilezedSessionService).remember).toHaveBeenCalledWith(buildings);
    expect(storage.rememberMap).not.toHaveBeenCalled();
  });

  it('shows and remembers WorldEd cell zones, with toggles saved as preferences', async () => {
    const file = new File([mapXml], 'cell.tmx');
    const zones = [{ name: '', group: 'FarmLand', type: 'FarmLand', color: '#bcff7d', level: 0,
      geometry: 'rectangle' as const, x: 1, y: 1, width: 2, height: 2, points: [] }];
    const buildings = { lots: [], files: new Map<string, File>(), zones };
    await component.openMap(file, true, buildings);
    expect(component.zones).toEqual(zones);
    expect(component.zoneSummary).toEqual([{ group: 'FarmLand', color: 'rgba(188, 255, 125, 1)', count: 1 }]);
    expect(storage.rememberMap).toHaveBeenCalledWith(file, buildings);
    component.setShowZones(false);
    expect(localStorage.getItem('tilezed:showZones')).toBe('0');
    component.setShowZones(true);
    localStorage.removeItem('tilezed:showZones');
  });

  it('orders loaded building sprites back-to-front without changing saved lot order', async () => {
    const preview = TestBed.inject(BuildingPreviewService) as jasmine.SpyObj<BuildingPreviewService>;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    preview.preview.and.resolveTo({ blob, width: 1, height: 1, squares: { minX: 0, minY: 0, maxX: 8, maxY: 10 },
      bounds: { left: -400, right: 400, top: -400, bottom: 400 }, warnings: [] });
    const front = { x: 0, y: 20, width: 8, height: 10, level: 0, map: 'front.tbx' };
    const rear = { ...front, y: 0, map: 'rear.tbx' };
    const frontFile = new File([''], 'front.tbx'), rearFile = new File([''], 'rear.tbx');
    const context = { lots: [front, rear], files: new Map([['front.tbx', frontFile], ['rear.tbx', rearFile]]) };
    await component.openMap(new File([mapXml], 'cell.tmx'), true, context);
    for (let i = 0; i < 50 && component.loadingBuildings; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(component.loadingBuildings).toBeFalse();
    expect(component.buildings?.loaded).toBe(2);
    expect(preview.preview.calls.allArgs().map(args => args[0])).toEqual([frontFile, rearFile]);
    expect(component.buildings?.sprites.map(sprite => sprite.squares.minY)).toEqual([0, 20]);
    expect(context.lots).toEqual([front, rear]);
    expect(storage.rememberMap.calls.mostRecent().args[1]?.lots).toEqual([front, rear]);
  });

  it('restores remembered building context along with the last cell', async () => {
    const file = new File([mapXml], 'cell.tmx');
    storage.lastMap.and.resolveTo(file);
    const buildings = { lots: [{ x: 1, y: 2, width: 3, height: 4, level: 0, map: 'missing.tbx' }],
      files: new Map<string, File>() };
    storage.lastBuildings.and.resolveTo(buildings);
    const restored = TestBed.createComponent(TilezedViewerComponent);
    restored.detectChanges();
    for (let i = 0; i < 50 && !restored.componentInstance.scene; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(storage.lastBuildings).toHaveBeenCalledWith(file);
    expect([...restored.componentInstance.buildings!.warnings].join(' ')).toContain('missing.tbx');
    restored.destroy();
  });

  it('does not replace a newly opened map with a slower saved-map read', async () => {
    let finish!: (file: File | undefined) => void;
    storage.lastMap.and.returnValue(new Promise(resolve => finish = resolve));
    const restored = TestBed.createComponent(TilezedViewerComponent);
    restored.detectChanges();

    await restored.componentInstance.openMap(new File([mapXml], 'newer.tmx'));
    finish(new File([mapXml], 'older.tmx'));
    await restored.whenStable();

    expect(restored.componentInstance.fileName).toBe('newer.tmx');
    expect(restored.componentInstance.restoredMap).toBeFalse();
    restored.destroy();
  });

  it('keeps the map open and reports a failure to remember it', async () => {
    spyOn(console, 'error');
    storage.rememberMap.and.rejectWith(new Error('Storage is full'));

    await component.openMap(new File([mapXml], 'map.tmx'));

    expect(component.scene).toBeDefined();
    expect(component.storageWarning).toContain('Storage is full');
    expect(console.error).toHaveBeenCalled();
  });

  it('reports an error reading the remembered map', async () => {
    spyOn(console, 'error');
    storage.lastMap.and.rejectWith(new Error('Storage is unavailable'));
    const restored = TestBed.createComponent(TilezedViewerComponent);
    restored.detectChanges();
    await restored.whenStable();
    for (let i = 0; i < 50 && !restored.componentInstance.storageWarning; i++) await new Promise(resolve => setTimeout(resolve, 5));

    expect(restored.componentInstance.storageWarning).toContain('Storage is unavailable');
    expect(console.error).toHaveBeenCalled();
    restored.destroy();
  });
});
