import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { BehaviorSubject } from 'rxjs';
import { Project } from '../../models/project.models';
import { AuthService } from '../../services/auth.service';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { ProjectApiService } from '../../services/project-api.service';
import { ProjectWorldService } from '../../services/project-world.service';
import { WorldedSessionService } from '../../services/worlded-session.service';
import { WorldedStorageService } from '../../services/worlded-storage.service';
import { readWorldedWorld } from '../../utils/worlded-world';
import { fitTilezedCamera } from '../../utils/tilezed-renderer';
import { worldedBounds } from '../../utils/worlded-renderer';
import { WorldedViewerModule } from './worlded-viewer.module';
import { WorldedViewerComponent } from './worlded-viewer.component';
import { THAMES_VALLEY_PROJECT_ID } from '../../utils/default-project';

@Component({ selector: 'app-worlded-route-test-host', template: '<router-outlet></router-outlet>' })
class WorldedRouteHost { }
@Component({ selector: 'app-worlded-test-landing', template: 'Sign in to open your projects.' })
class WorldedLandingStub { }

const project: Project = { id: THAMES_VALLEY_PROJECT_ID, name: 'Thames Valley', description: '', role: 'contributor', visibility: 'private' };
const localXml = '<world version="1.0" width="1" height="1" cellFormat="legacy-300"/>';
const cloudXml = '<world version="1.0" width="2" height="2" cellFormat="native-256"/>';

describe('WorldEd uploaded-world routing', () => {
  let fixture: ComponentFixture<WorldedRouteHost>;
  let router: Router;
  let api: jasmine.SpyObj<ProjectApiService>;
  let worlds: jasmine.SpyObj<ProjectWorldService>;
  let storage: jasmine.SpyObj<WorldedStorageService>;
  let user$: BehaviorSubject<{ uid: string } | null>;

  beforeEach(async () => {
    user$ = new BehaviorSubject<{ uid: string } | null>({ uid: 'member' });
    api = jasmine.createSpyObj('ProjectApiService', ['projects', 'project']);
    api.projects.and.resolveTo([project]);
    api.project.and.resolveTo(project);
    worlds = jasmine.createSpyObj('ProjectWorldService', ['world', 'resources', 'save', 'upload']);
    worlds.world.and.resolveTo({ projectId: project.id, name: 'uploaded.pzw', revision: 2, xml: cloudXml,
      files: [], updatedAt: '2026-11-08T12:00:00Z', updatedBy: 'admin' });
    worlds.resources.and.resolveTo(new Map());
    storage = jasmine.createSpyObj('WorldedStorageService', ['lastWorld', 'rememberWorld']);
    const local = { worldFile: new File([localXml], 'local.pzw'), files: new Map<string, File>(),
      folderName: 'Old local project', warnings: [], omittedResources: 0 };
    storage.lastWorld.and.resolveTo(local);
    const sessions = new WorldedSessionService();
    sessions.current = { ...local, world: readWorldedWorld(localXml), restored: true };
    await TestBed.configureTestingModule({
      declarations: [WorldedRouteHost, WorldedLandingStub],
      imports: [RouterTestingModule.withRoutes([
        { path: 'worlded', loadChildren: () => Promise.resolve(WorldedViewerModule) },
        { path: '', component: WorldedLandingStub, pathMatch: 'full' },
      ])],
      providers: [
        { provide: AuthService, useValue: { get user() { return user$.value; }, user$,
          get canViewWorlds() { return !!user$.value; }, isAdmin: false } },
        { provide: ProjectApiService, useValue: api },
        { provide: ProjectWorldService, useValue: worlds },
        { provide: WorldedStorageService, useValue: storage },
        { provide: WorldedSessionService, useValue: sessions },
        { provide: BuildingPreviewService, useValue: jasmine.createSpyObj('BuildingPreviewService', ['preview']) },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(WorldedRouteHost);
    fixture.autoDetectChanges();
  });
  afterEach(() => { fixture.destroy(); router.dispose(); });
  async function openWorlded(): Promise<void> {
    await fixture.ngZone!.run(() => router.navigateByUrl('/worlded'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('opens the uploaded world from the main WorldEd link despite cached local worlds', async () => {
    await openWorlded();
    expect(router.url).toBe(`/worlded/project/${project.id}`);
    expect(worlds.world).toHaveBeenCalledOnceWith(project.id);
    expect(fixture.nativeElement.textContent).toContain('uploaded.pzw');
    expect(fixture.nativeElement.textContent).toContain('256 tiles per cell');
    expect(fixture.nativeElement.textContent).not.toContain('local.pzw');
    expect(storage.lastWorld).not.toHaveBeenCalled();
    expect(storage.rememberWorld).not.toHaveBeenCalled();
  });
  it('opens only Thames Valley when several projects are available', async () => {
    api.projects.and.resolveTo([project, { ...project, id: 'other', name: 'Other map' }]);
    await openWorlded();
    expect(router.url).toBe(`/worlded/project/${project.id}`);
    expect(fixture.nativeElement.querySelector('a[href="/worlded/project/other"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="file"]:not([hidden])')).toBeNull();
    expect(worlds.world).toHaveBeenCalledOnceWith(project.id);
    expect(storage.lastWorld).not.toHaveBeenCalled();
  });
  it('fits and paints the initial project map without mouse input or ResizeObserver', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')!;
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: undefined });
    try {
      await openWorlded();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const viewer = fixture.debugElement.query(By.directive(WorldedViewerComponent)).componentInstance as WorldedViewerComponent;
      const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const expected = fitTilezedCamera(worldedBounds(readWorldedWorld(cloudXml)), { width: rect.width, height: rect.height });
      expect(viewer.zoomPercent).toBe(Math.round(expected.zoom * 100));
      const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * .625), Math.floor(canvas.height * .6), 1, 1).data;
      expect(pixel[3]).toBe(255);
      expect(Array.from(pixel).slice(0, 3)).not.toEqual([32, 35, 39]);
      expect(worlds.resources).toHaveBeenCalledTimes(1);
    } finally { Object.defineProperty(window, 'ResizeObserver', descriptor); }
  });
  it('shows the missing-upload message instead of restoring a local world', async () => {
    worlds.world.and.resolveTo(null);
    await openWorlded();
    expect(fixture.nativeElement.textContent).toContain('The admin has not uploaded a world');
    expect(fixture.nativeElement.textContent).not.toContain('local.pzw');
    expect(storage.lastWorld).not.toHaveBeenCalled();
  });
  it('requires sign-in before opening WorldEd', async () => {
    user$.next(null);
    await openWorlded();
    expect(router.url).toBe('/?signIn=required');
    expect(api.projects).not.toHaveBeenCalled();
    expect(worlds.world).not.toHaveBeenCalled();
    expect(storage.lastWorld).not.toHaveBeenCalled();
  });
  it('reports cloud failures without falling back to the local snapshot', async () => {
    worlds.world.and.rejectWith(new Error('You must be invited to this project.'));
    await openWorlded();
    expect(fixture.nativeElement.textContent).toContain('You must be invited');
    expect(fixture.nativeElement.textContent).not.toContain('local.pzw');
    expect(storage.lastWorld).not.toHaveBeenCalled();
  });
  it('shows an empty project state without a local file picker', async () => {
    api.projects.and.resolveTo([]);
    await openWorlded();
    expect(fixture.nativeElement.textContent).toContain('No projects are available');
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(storage.lastWorld).not.toHaveBeenCalled();
  });
});
