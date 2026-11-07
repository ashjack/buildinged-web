import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { DbService } from '../../services/db.service';
import { TilezedAssetsService } from '../../services/tilezed-assets.service';
import { TilezedHandoffService } from '../../services/tilezed-handoff.service';
import { TilezedStorageService } from '../../services/tilezed-storage.service';
import { TilezedViewerComponent } from './tilezed-viewer.component';
import { BuildingPreviewService } from '../../services/building-preview.service';

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

  beforeEach(() => {
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
      imports: [CommonModule, RouterTestingModule],
      providers: [
        { provide: BuildingPreviewService, useValue: jasmine.createSpyObj('BuildingPreviewService', ['preview']) },
        { provide: DbService, useValue: { sheetsChanged: changes } },
        { provide: TilezedAssetsService, useValue: assets },
        { provide: TilezedStorageService, useValue: storage },
      ],
    });
    fixture = TestBed.createComponent(TilezedViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => { fixture.destroy(); changes.complete(); });

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

    expect(restored.componentInstance.storageWarning).toContain('Storage is unavailable');
    expect(console.error).toHaveBeenCalled();
    restored.destroy();
  });
});
