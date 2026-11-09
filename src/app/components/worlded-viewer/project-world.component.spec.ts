import { CommonModule } from '@angular/common';
import { Component, forwardRef, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService, ProjectRequestError } from '../../services/project-api.service';
import { ProjectWorldDocument, ProjectWorldService, WORLD_ADMIN_UID } from '../../services/project-world.service';
import { WorldedSession } from '../../services/worlded-session.service';
import { ProjectWorldComponent } from './project-world.component';
import { WorldedViewerComponent } from './worlded-viewer.component';

@Component({ selector: 'app-worlded-viewer', template: '', providers: [
  { provide: WorldedViewerComponent, useExisting: forwardRef(() => WorldViewerStub) },
] })
class WorldViewerStub {
  @Input() worldRevision?: number;
  @Input() hosted = false;
  @Input() minimal = false;
  @Input() projectId?: string;
  zoomPercent = 100;
  warnings: string[] = [];
  workspace?: WorldedSession;
  async openHosted(session: WorldedSession): Promise<void> { this.workspace = session; }
}

const xml = `<world version="1.0" width="2" height="2" cellFormat="native-256">
  <otherworld path="adjacent.pzw"/><road x1="1" y1="2" custom="preserve"/>
  <cell x="0" y="0" map="maps/cell.tmx" chunkDataOverride="chunks.bin">
    <property name="custom" value="keep"/><feature><geometry type="Point"/></feature>
    <lot x="1" y="2" width="10" height="20" level="0" map="house.tbx"/>
  </cell><cell x="1" y="1" map="other.tmx"/>
</world>`;
describe('Project world editor', () => {
  let fixture: ComponentFixture<ProjectWorldComponent>;
  let component: ProjectWorldComponent;
  let worlds: jasmine.SpyObj<ProjectWorldService>;
  let cloud: ProjectWorldDocument;
  let user$: BehaviorSubject<{ uid: string } | null>;
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let accountAdmin: boolean;
  beforeEach(async () => {
    accountAdmin = true;
    cloud = { projectId: 'p', name: 'world.pzw', revision: 3, xml, files: [], updatedAt: '2026-11-08T12:00:00Z', updatedBy: 'admin' };
    user$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'editor' });
    params$ = new BehaviorSubject(convertToParamMap({ projectId: 'p' }));
    worlds = jasmine.createSpyObj('ProjectWorldService', ['world', 'resources', 'save', 'upload']);
    worlds.world.and.resolveTo(cloud);
    worlds.resources.and.resolveTo(new Map([['house.tbx', new File(['<building/>'], 'house.tbx')]]));
    const api = jasmine.createSpyObj('ProjectApiService', ['project']);
    api.project.and.resolveTo({ id: 'p', name: 'Shared map', role: 'contributor' });
    await TestBed.configureTestingModule({
      declarations: [ProjectWorldComponent, WorldViewerStub], imports: [CommonModule, RouterTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: params$.value }, paramMap: params$ } },
        { provide: AuthService, useValue: { get user() { return user$.value; }, user$,
          get isAdmin() { return !!user$.value && (accountAdmin || user$.value.uid === WORLD_ADMIN_UID); }, canViewWorlds: true } },
        { provide: ProjectApiService, useValue: api }, { provide: ProjectWorldService, useValue: worlds },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectWorldComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  function editLot(): void {
    component.viewer.workspace!.selectedCell = { x: 0, y: 0 };
    component.selectCell();
    component.set(component.lots[0], 'x', { target: { value: '42' } } as unknown as Event);
  }
  it('shows a read-only world to contributors and hides editing and upload controls', () => {
    accountAdmin = false;
    fixture.detectChanges();
    expect(component.ready).toBeTrue();
    expect(component.viewer.workspace?.world.cellSize).toBe(256);
    expect(fixture.nativeElement.querySelector('.upload')).toBeNull();
    expect(fixture.nativeElement.querySelector('.editor')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Read-only world view');
    expect(component.isAdmin).toBeFalse();
  });
  it('does not mutate or save a contributor world even when editing methods are called directly', async () => {
    accountAdmin = false;
    component.viewer.workspace!.selectedCell = { x: 0, y: 0 };
    const before = new XMLSerializer().serializeToString(component.document!);
    component.selectCell();
    component.set(component.document!.querySelector('lot')!, 'x', { target: { value: '42' } } as unknown as Event);
    component.add('lot');
    component.remove(component.document!.querySelector('lot')!);
    await component.save();
    expect(new XMLSerializer().serializeToString(component.document!)).toBe(before);
    expect(component.dirty).toBeFalse();
    expect(worlds.save).not.toHaveBeenCalled();
    expect(worlds.upload).not.toHaveBeenCalled();
  });
  it('fills the viewport with the map and keeps project controls collapsed initially', () => {
    const page = fixture.nativeElement.querySelector('.fullscreen') as HTMLElement;
    const panel = fixture.nativeElement.querySelector('.project-controls') as HTMLElement;
    const bounds = page.getBoundingClientRect();
    expect(bounds.width).toBe(document.documentElement.clientWidth);
    expect(bounds.height).toBe(window.innerHeight);
    expect(getComputedStyle(panel).display).toBe('none');
    expect(fixture.nativeElement.querySelector('.panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });
  it('links a selected TBX lot to direct building editing, excluding missing files and terrain maps', () => {
    cloud.files = [{ id: 'building', path: 'house.tbx', size: 20 }];
    component.viewer.workspace!.selectedCell = { x: 0, y: 0 };
    component.selectCell();
    component.toggleControls();
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.entry a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Edit building');
    expect(link.getAttribute('href')).toBe('/projects/p/world-buildings/house.tbx/edit');
    component.lots[0].setAttribute('map', 'missing.tbx');
    expect(component.buildingPath(component.lots[0])).toBeUndefined();
    component.lots[0].setAttribute('map', 'maps/cell.tmx');
    expect(component.buildingPath(component.lots[0])).toBeUndefined();
  });

  it('toggles controls without recreating the viewer or reloading project resources', () => {
    const viewer = component.viewer;
    const element = fixture.nativeElement.querySelector('app-worlded-viewer');
    const toggle = fixture.nativeElement.querySelector('.panel-toggle') as HTMLButtonElement;
    const panel = fixture.nativeElement.querySelector('.project-controls') as HTMLElement;
    worlds.resources.calls.reset();
    toggle.click();
    expect(component.controlsOpen).toBeTrue();
    expect(getComputedStyle(panel).display).not.toBe('none');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(panel);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.controlsOpen).toBeFalse();
    expect(getComputedStyle(panel).display).toBe('none');
    expect(document.activeElement).toBe(toggle);
    expect(component.viewer).toBe(viewer);
    expect(fixture.nativeElement.querySelector('app-worlded-viewer')).toBe(element);
    expect(worlds.resources).not.toHaveBeenCalled();
  });
  it('keeps admin upload controls inside the collapsed panel', async () => {
    user$.next({ uid: WORLD_ADMIN_UID });
    await component.load();
    fixture.detectChanges();
    const upload = fixture.nativeElement.querySelector('.upload') as HTMLElement;
    expect(upload.closest('.project-controls')).not.toBeNull();
    expect(upload.getClientRects().length).toBe(0);
    component.toggleControls();
    expect(upload.getClientRects().length).toBeGreaterThan(0);
  });
  it('recognizes only the specified admin UID', () => {
    accountAdmin = false;
    expect(component.isAdmin).toBeFalse();
    user$.next({ uid: WORLD_ADMIN_UID });
    expect(component.isAdmin).toBeTrue();
    user$.next({ uid: `${WORLD_ADMIN_UID}x` });
    expect(component.isAdmin).toBeFalse();
  });
  it('preserves native world data outside the changed lot and saves with its cloud revision', async () => {
    editLot();
    worlds.save.and.resolveTo({ ...cloud, revision: 4 });
    await component.save();
    const args = worlds.save.calls.mostRecent().args;
    const document = new DOMParser().parseFromString(args[1], 'application/xml');
    expect(args[0]).toBe('p'); expect(args[2]).toBe(3);
    expect(document.querySelector('lot')?.getAttribute('x')).toBe('42');
    expect(document.querySelector('road')?.getAttribute('custom')).toBe('preserve');
    expect(document.querySelector('otherworld')?.getAttribute('path')).toBe('adjacent.pzw');
    expect(document.querySelector('cell')?.getAttribute('chunkDataOverride')).toBe('chunks.bin');
    expect(document.querySelector('property')?.getAttribute('value')).toBe('keep');
    expect(document.querySelector('feature geometry')?.getAttribute('type')).toBe('Point');
    expect(document.querySelectorAll('cell').length).toBe(2);
    expect(component.dirty).toBeFalse(); expect(component.cloud?.revision).toBe(4);
  });
  it('keeps unsaved edits after a save conflict and warns before leaving', async () => {
    editLot();
    worlds.save.and.rejectWith(new Error('The world changed in another session.'));
    await component.save();
    expect(component.dirty).toBeTrue();
    expect(component.attr(component.lots[0], 'x')).toBe('42');
    expect(component.cloud?.revision).toBe(3);
    expect(component.error).toContain('another session');
    spyOn(window, 'confirm').and.returnValue(false);
    expect(component.canLeave()).toBeFalse();
    await component.load();
    expect(worlds.world).toHaveBeenCalledTimes(1);
  });
  it('clears hosted content and disables editing after sign-out', () => {
    user$.next(null);
    fixture.detectChanges();
    expect(component.ready).toBeFalse(); expect(component.document).toBeUndefined();
    expect(component.files.size).toBe(0);
    expect(fixture.nativeElement.querySelector('.editor')).toBeNull();
  });
  it('loads the new project when the router reuses this component for another project', async () => {
    params$.next(convertToParamMap({ projectId: 'other-project' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(component.projectId).toBe('other-project');
    expect(worlds.world).toHaveBeenCalledWith('other-project');
    expect(component.ready).toBeTrue();
  });
  it('checks unchanged revisions without reloading files or rebuilding the map', async () => {
    worlds.resources.calls.reset();
    const preview = spyOn(component.viewer, 'openHosted').and.callThrough();
    await component.sync();
    await component.load();
    expect(worlds.resources).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
  it('applies remote changes automatically when the world has no unsaved edits', async () => {
    worlds.world.and.resolveTo({ ...cloud, revision: 4 });
    const preview = spyOn(component.viewer, 'openHosted').and.callThrough();
    await component.sync();
    expect(component.cloud?.revision).toBe(4);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(component.syncMessage).toContain('Updated');
  });
  it('preserves unsaved edits when another editor saves a newer world', async () => {
    editLot();
    worlds.world.and.resolveTo({ ...cloud, revision: 4 });
    worlds.resources.calls.reset();
    await component.sync();
    expect(component.cloud?.revision).toBe(3);
    expect(component.attr(component.lots[0], 'x')).toBe('42');
    expect(component.dirty).toBeTrue();
    expect(worlds.resources).not.toHaveBeenCalled();
    expect(component.syncMessage).toContain('unsaved edits');
  });
  it('hides the cached world when project access is revoked', async () => {
    worlds.world.and.rejectWith(new ProjectRequestError('Membership removed.', 403));
    await component.sync();
    expect(component.ready).toBeFalse();
    expect(component.document).toBeUndefined();
    expect(component.error).toContain('Membership removed');
  });
});
