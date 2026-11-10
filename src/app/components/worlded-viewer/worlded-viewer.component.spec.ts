import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TilezedHandoffService } from '../../services/tilezed-handoff.service';
import { WorldedSessionService } from '../../services/worlded-session.service';
import { WorldedSnapshotResult, WorldedStorageService } from '../../services/worlded-storage.service';
import { WorldedCellPanelComponent } from './worlded-cell-panel.component';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { WorldedViewerComponent } from './worlded-viewer.component';
import { readWorldedWorld } from '../../utils/worlded-world';
import { fitTilezedCamera } from '../../utils/tilezed-renderer';
import { worldedBounds } from '../../utils/worlded-renderer';

const worldXml = `<world version="1.0" width="2" height="1" cellFormat="legacy-300">
  <cell x="1" y="0" map="maps/cell.tmx">
    <lot x="2" y="3" width="4" height="5" level="0" map="house.tbx"/>
  </cell>
</world>`;

describe('WorldEd read-only viewer', () => {
  let fixture: ComponentFixture<WorldedViewerComponent>;
  let component: WorldedViewerComponent;
  let storage: jasmine.SpyObj<WorldedStorageService>;
  let handoff: jasmine.SpyObj<TilezedHandoffService>;
  let sessions: WorldedSessionService;
  let navigate: jasmine.Spy;

  const projectFile = (path: string, content: string): File => {
    const file = new File([content], path.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  };

  beforeEach(() => {
    storage = jasmine.createSpyObj<WorldedStorageService>('WorldedStorageService', ['lastWorld', 'rememberWorld']);
    storage.lastWorld.and.resolveTo(undefined);
    storage.rememberWorld.and.callFake(async project => ({
      worldFile: project.worldFile, files: project.files, omittedResources: 0,
    }));
    handoff = jasmine.createSpyObj<TilezedHandoffService>('TilezedHandoffService', ['send', 'take', 'clear']);
    sessions = new WorldedSessionService();
    TestBed.configureTestingModule({
      declarations: [WorldedViewerComponent, WorldedCellPanelComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        { provide: BuildingPreviewService, useValue: jasmine.createSpyObj('BuildingPreviewService', ['preview']) },
        { provide: WorldedStorageService, useValue: storage },
        { provide: WorldedSessionService, useValue: sessions },
        { provide: TilezedHandoffService, useValue: handoff },
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(WorldedViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('fits and paints a world loaded while hidden as soon as it becomes visible, without wheel input', async () => {
    const hosted = TestBed.createComponent(WorldedViewerComponent);
    hosted.componentInstance.hosted = true;
    hosted.componentInstance.minimal = true;
    const host = hosted.nativeElement as HTMLElement;
    host.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px;display:none';
    hosted.detectChanges();
    const xml = '<world version="1.0" width="2" height="2"/>';
    const world = readWorldedWorld(xml);
    try {
      await hosted.componentInstance.openHosted({ world, worldFile: new File([xml], 'uploaded.pzw'),
        files: new Map(), folderName: 'Uploaded', warnings: [], omittedResources: 0, restored: false });
      host.style.display = 'block';
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const canvas = hosted.nativeElement.querySelector('canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const expected = fitTilezedCamera(worldedBounds(world), { width: rect.width, height: rect.height });
      expect(hosted.componentInstance.zoomPercent).toBe(Math.round(expected.zoom * 100));
      const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * .625), Math.floor(canvas.height * .6), 1, 1).data;
      expect(pixel[3]).toBe(255);
      expect(Array.from(pixel).slice(0, 3)).not.toEqual([32, 35, 39]);
    } finally { hosted.destroy(); }
  });

  it('keeps unchanged buildings and camera when a hosted world receives only zone edits', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    const previous = sessions.current!;
    const buildings = component.buildings;
    component.zoom(1.25);
    const zoom = component.zoomPercent;
    const updated = worldXml.replace('</cell>', '<object name="New zone" x="1" y="2" width="3" height="4" level="0"/></cell>');
    await component.openHosted({ ...previous, world: readWorldedWorld(updated), worldFile: new File([updated], 'world.pzw') });
    expect(component.workspace?.world.objectCount).toBe(1);
    expect(component.buildings).toBe(buildings);
    expect(component.zoomPercent).toBe(zoom);
  });

  it('opens a world and keeps it when a later file is invalid', async () => {
    const file = new File([worldXml], 'world.pzw');
    await component.openWorld(file);
    expect(component.workspace?.world.lotCount).toBe(1);
    expect(component.workspace?.world.cellSize).toBe(300);
    expect(storage.rememberWorld).toHaveBeenCalledTimes(1);
    const previous = component.workspace;

    await component.openWorld(new File(['<world>'], 'broken.pzw'));

    expect(component.workspace).toBe(previous);
    expect(component.error).toContain('valid XML');
    expect(storage.rememberWorld).toHaveBeenCalledTimes(1);
  });

  it('opens a selected local cell in TileZed and retains the world session', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    const map = projectFile('Project/maps/cell.tmx', '<map/>');
    await component.connectProject([projectFile('Project/world.pzw', worldXml), map]);
    component.selectCell({ x: 1, y: 0 });

    expect(component.selectedCell?.lots.length).toBe(1);
    expect(component.selectedMapFile).toBe(map);
    await component.openSelectedCell();
    expect(handoff.send).toHaveBeenCalledOnceWith(map, {
      lots: component.selectedCell!.lots, files: component.workspace!.files, zones: component.selectedCell!.zones, cell: { x: 1, y: 0 },
    });
    expect(navigate).toHaveBeenCalledOnceWith(['/tilezed']);
    expect(sessions.current?.selectedCell).toEqual({ x: 1, y: 0 });
  });

  it('uses the saved in-memory copy of a project map after saving', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    const map = projectFile('Project/maps/cell.tmx', '<map/>');
    const copiedMap = new File(['<map/>'], 'cell.tmx');
    storage.rememberWorld.and.callFake(async project => ({
      worldFile: project.worldFile, files: new Map([['maps/cell.tmx', copiedMap]]), omittedResources: 0,
    }));

    await component.connectProject([projectFile('Project/world.pzw', worldXml), map]);
    component.selectCell({ x: 1, y: 0 });

    expect(component.selectedMapFile).toBe(copiedMap);
  });

  it('hands the hosted map path and world revision to TileZed for conflict-checked manual saves', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    const map = projectFile('Project/maps/cell.tmx', '<map/>');
    await component.connectProject([projectFile('Project/world.pzw', worldXml), map]);
    component.hosted = true; component.projectId = 'shared'; component.worldRevision = 12;
    component.selectCell({ x: 1, y: 0 });
    await component.openSelectedCell();
    expect(handoff.send.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      projectId: 'shared', mapPath: 'maps/cell.tmx', worldRevision: 12,
    }));
  });

  it('restores the current world and selected cell when returning from TileZed', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    component.selectCell({ x: 1, y: 0 });
    const returned = TestBed.createComponent(WorldedViewerComponent);
    returned.detectChanges();
    await returned.whenStable();

    expect(returned.componentInstance.workspace?.worldFile.name).toBe('world.pzw');
    expect(returned.componentInstance.selectedCell?.x).toBe(1);
    expect(returned.componentInstance.selectedCell?.y).toBe(0);
    returned.destroy();
  });

  it('clears the handoff and reports unsuccessful navigation', async () => {
    navigate.and.resolveTo(false);
    await component.openWorld(new File([worldXml], 'world.pzw'));
    const map = projectFile('Project/maps/cell.tmx', '<map/>');
    await component.connectProject([projectFile('Project/world.pzw', worldXml), map]);
    component.selectCell({ x: 1, y: 0 });

    await component.openSelectedCell();

    expect(handoff.clear).toHaveBeenCalledOnceWith(map);
    expect(component.error).toContain('Could not open');
  });

  it('selects and opens cells using the keyboard', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(component.selectedCell).toBeDefined();
    component.selectCell({ x: 0, y: 0 });
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    expect(component.selectedCell?.x).toBe(1);
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    expect(component.selectedCell?.y).toBe(0);
    const open = spyOn(component, 'openSelectedCell').and.resolveTo();
    component.loadingWorld = true;
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(open).not.toHaveBeenCalled();
    component.loadingWorld = false;
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', repeat: true }));
    expect(open).not.toHaveBeenCalled();
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports a wrong project folder without replacing the open world', async () => {
    await component.openWorld(new File([worldXml], 'world.pzw'));
    const previous = component.workspace;
    await component.connectProject([projectFile('Wrong/world.pzw', 'different')]);
    expect(component.workspace).toBe(previous);
    expect(component.error).toContain('different copy');
  });

  it('restores a saved world and its cell map without a folder selection', async () => {
    const map = new File(['<map/>'], 'cell.tmx');
    storage.lastWorld.and.resolveTo({
      worldFile: new File([worldXml], 'remembered.pzw'),
      files: new Map([['maps/cell.tmx', map]]),
      folderName: 'Project', warnings: [], omittedResources: 0,
    });
    const restored = TestBed.createComponent(WorldedViewerComponent);
    restored.detectChanges();
    for (let i = 0; i < 50 && !restored.componentInstance.workspace; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    expect(restored.componentInstance.workspace?.worldFile.name).toBe('remembered.pzw');
    expect(restored.componentInstance.workspace?.restored).toBeTrue();
    restored.componentInstance.selectCell({ x: 1, y: 0 });
    expect(restored.componentInstance.selectedMapFile).toBe(map);
    expect(storage.rememberWorld).not.toHaveBeenCalled();
    restored.destroy();
  });

  it('does not replace a newly opened world with a slower saved-world read', async () => {
    let finish!: (value: Awaited<ReturnType<WorldedStorageService['lastWorld']>>) => void;
    storage.lastWorld.and.returnValue(new Promise(resolve => finish = resolve));
    const restored = TestBed.createComponent(WorldedViewerComponent);
    restored.detectChanges();

    await restored.componentInstance.openWorld(new File([worldXml], 'newer.pzw'));
    finish({ worldFile: new File([worldXml], 'older.pzw'), files: new Map(),
      folderName: '', warnings: [], omittedResources: 0 });
    await restored.whenStable();

    expect(restored.componentInstance.workspace?.worldFile.name).toBe('newer.pzw');
    restored.destroy();
  });

  it('keeps the world visible and reports browser storage failures', async () => {
    spyOn(console, 'error');
    storage.rememberWorld.and.rejectWith(new Error('Storage is full'));
    await component.openWorld(new File([worldXml], 'world.pzw'));
    expect(component.workspace).toBeDefined();
    expect(component.storageWarning).toContain('Storage is full');
    expect(console.error).toHaveBeenCalled();
  });

  it('reports a storage failure if the viewer is left and reopened while saving', async () => {
    spyOn(console, 'error');
    let rejectWrite!: (error: Error) => void;
    storage.rememberWorld.and.returnValue(new Promise<WorldedSnapshotResult>((_resolve, reject) => rejectWrite = reject));
    const opening = component.openWorld(new File([worldXml], 'world.pzw'));
    for (let i = 0; i < 50 && !sessions.current; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(sessions.current).toBeDefined();
    fixture.destroy();
    const returned = TestBed.createComponent(WorldedViewerComponent);
    returned.autoDetectChanges();
    await returned.whenStable();
    rejectWrite(new Error('Storage is full'));
    await opening;
    await returned.whenStable();

    expect(returned.componentInstance.storageWarning).toContain('Storage is full');
    expect(returned.nativeElement.textContent).toContain('Storage is full');
    returned.destroy();
  });

  it('reports omitted-file counts if the viewer is left and reopened while saving', async () => {
    let finishWrite!: (snapshot: WorldedSnapshotResult) => void;
    storage.rememberWorld.and.returnValue(new Promise<WorldedSnapshotResult>(resolve => finishWrite = resolve));
    const opening = component.openWorld(new File([worldXml], 'world.pzw'));
    for (let i = 0; i < 50 && !sessions.current; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(sessions.current).toBeDefined();
    fixture.destroy();
    const returned = TestBed.createComponent(WorldedViewerComponent);
    returned.autoDetectChanges();
    await returned.whenStable();
    finishWrite({ worldFile: sessions.current!.worldFile, files: new Map(), omittedResources: 2 });
    await opening;
    await returned.whenStable();

    expect(returned.componentInstance.warnings.join(' ')).toContain('2 project files');
    expect(returned.nativeElement.textContent).toContain('2 project files');
    returned.destroy();
  });
});
