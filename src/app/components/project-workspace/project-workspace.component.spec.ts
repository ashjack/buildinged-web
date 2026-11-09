import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';
import { ProjectWorldDocument, ProjectWorldService } from '../../services/project-world.service';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { Contribution, Project, ProjectTask } from '../../models/project.models';
import { ProjectWorkspaceComponent } from './project-workspace.component';

const project: Project = { id: 'project', name: 'Community map', description: 'Shared tasks', visibility: 'public', role: 'contributor' };
const task: ProjectTask = {
  id: 'task', projectId: 'project', title: 'Make shop tiles', type: 'tile', description: 'Create a sign',
  requirements: 'Two directions', priority: 'normal', status: 'available', sourceBuildId: null, sourceRevisionId: null,
  references: [{ imageUrl: 'https://example.test/ref.png', sourceUrl: 'https://example.test/page', alt: 'Shop sign', caption: 'Reference' }],
  revision: 1
};

describe('Project workspace pages', () => {
  let api: jasmine.SpyObj<ProjectApiService>;
  let taskId: string | null;
  let worlds: jasmine.SpyObj<ProjectWorldService>;
  let previews: jasmine.SpyObj<BuildingPreviewService>;
  const cloud: ProjectWorldDocument = { projectId: 'project', name: 'map.pzw', revision: 1,
    updatedAt: '', updatedBy: 'admin', xml: '<world version="1.0" width="1" height="1"/>', files: [
      { id: 'z', path: 'z/hall.tbx', size: 10 }, { id: 'a10', path: 'a/house10.tbx', size: 10 },
      { id: 'map', path: 'maps/cell.tmx', size: 10 }, { id: 'a2', path: 'a/house2.TBX', size: 10 }
    ] };
  const configure = (role: Project['role'] = 'contributor', view = 'tasks'): void => {
    api = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['project', 'tasks', 'builds', 'task', 'contributions', 'members', 'request']);
    api.project.and.resolveTo({ ...project, role });
    api.tasks.and.resolveTo([task]);
    api.builds.and.resolveTo([]);
    api.task.and.resolveTo(task);
    api.contributions.and.resolveTo([]);
    api.members.and.resolveTo([]);
    worlds = jasmine.createSpyObj('ProjectWorldService', ['world', 'file', 'resources']);
    worlds.world.and.resolveTo(cloud);
    worlds.file.and.resolveTo(new File(['<building version="3"><floor/></building>'], 'house.tbx'));
    previews = jasmine.createSpyObj('BuildingPreviewService', ['preview']);
    const params = convertToParamMap({ projectId: 'project', ...(taskId ? { taskId } : {}) });
    TestBed.configureTestingModule({
      declarations: [ProjectWorkspaceComponent], imports: [CommonModule, FormsModule, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: { user: { uid: 'user', displayName: 'Contributor' }, user$: of({ uid: 'user' }),
          isAdmin: role !== 'contributor', canViewWorlds: true } },
        { provide: ProjectApiService, useValue: api },
        { provide: ProjectWorldService, useValue: worlds },
        { provide: BuildingPreviewService, useValue: previews },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: params, queryParamMap: convertToParamMap({ view }) }, paramMap: of(params) } }
      ]
    });
  };
  it('shows shared tasks and hides administration from ordinary contributors', async () => {
    taskId = null; configure();
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Make shop tiles');
    expect(text).toContain('Nobody owns the task exclusively');
    expect(text).not.toContain('Project access');
    expect(text).not.toContain('Create a task');
  });

  it('owners can manage visibility, membership, and task creation', async () => {
    taskId = null; configure('owner');
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Project access');
    expect(fixture.nativeElement.textContent).toContain('Create a task');
    expect(api.members).toHaveBeenCalledWith('project');
  });

  it('hides world viewers, building catalogs and management tools from Normal accounts even with a project owner role', async () => {
    taskId = null; configure('owner', 'buildings');
    const auth = TestBed.inject(AuthService);
    Object.defineProperties(auth, { isAdmin: { value: false }, canViewWorlds: { value: false } });
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/worlded/project/project"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('World buildings');
    expect(fixture.nativeElement.textContent).not.toContain('Project access');
    expect(fixture.nativeElement.textContent).not.toContain('Create a task');
    expect(fixture.componentInstance.view).toBe('tasks');
    expect(worlds.world).not.toHaveBeenCalled();
    expect(api.members).not.toHaveBeenCalled();
  });

  it('lists every uploaded TBX by full path and filters without downloading world resources', async () => {
    taskId = null; configure();
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    component.selectView('buildings');
    await fixture.whenStable(); fixture.detectChanges();
    const rows = [...fixture.nativeElement.querySelectorAll('.building-path strong')] as HTMLElement[];
    expect(rows.map(row => row.textContent)).toEqual(['a/house2.TBX', 'a/house10.tbx', 'z/hall.tbx']);
    expect(worlds.file).not.toHaveBeenCalled();
    expect(worlds.resources).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.building-row').textContent).not.toContain('Create task');
    component.buildingSearch = 'HOUSE';
    expect(component.visibleBuildings.map(building => building.id)).toEqual(['a2', 'a10']);
    component.worldBuildings = Array.from({ length: 125 }, (_, i) => ({ id: `${i}`, path: `folder/${i}.tbx`, size: 1 }));
    component.buildingSearch = '';
    component.buildingPage = 2;
    expect(component.visibleBuildings.length).toBe(25);
    expect(component.buildingPages).toBe(3);
  });

  it('previews only the chosen building and releases its image when closed', async () => {
    taskId = null; configure();
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    await component.loadWorldBuildings();
    previews.preview.and.resolveTo({ blob: new Blob(['image'], { type: 'image/png' }), width: 50, height: 50,
      bounds: { left: 0, top: 0, right: 50, bottom: 50 }, squares: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, warnings: ['Missing tiles'] });
    const revoke = spyOn(URL, 'revokeObjectURL');
    await component.viewBuilding(cloud.files[0]);
    const url = component.previewUrl;
    expect(worlds.file).toHaveBeenCalledOnceWith(cloud, cloud.files[0]);
    expect(component.previewWarnings).toEqual(['Missing tiles']);
    expect(url.startsWith('blob:')).toBeTrue();
    component.closeBuildingPreview();
    expect(revoke).toHaveBeenCalledWith(url);
    expect(component.previewBuilding).toBeUndefined();
    expect(worlds.resources).not.toHaveBeenCalled();
  });

  it('opens the building catalog directly from the WorldEd toolbar link', async () => {
    taskId = null; configure('owner', 'buildings');
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.view).toBe('buildings');
    expect(fixture.nativeElement.querySelectorAll('.building-row').length).toBe(3);
    expect(worlds.world).toHaveBeenCalledOnceWith('project');
    expect(worlds.resources).not.toHaveBeenCalled();
  });

  it('creates a furnishing task from a pinned world building using the existing brief form', async () => {
    taskId = null; configure('reviewer');
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    await component.loadWorldBuildings();
    component.taskFromBuilding(cloud.files[0]);
    fixture.detectChanges(); await fixture.whenStable();
    expect(component.showTaskForm).toBeTrue();
    expect(component.view).toBe('tasks');
    expect(component.draft.title).toBe('Furnish hall');
    expect(fixture.nativeElement.querySelector('.source-world-path').textContent).toContain('z/hall.tbx');
    expect(api.request).not.toHaveBeenCalled();
    const source = { id: 'pinned', projectId: 'project', name: 'z/hall.tbx', revisionId: 'revision', worldFileId: 'z', worldPath: 'z/hall.tbx' };
    api.request.and.callFake(async <T>(_method: string, path: string): Promise<T> => (path.endsWith('/builds') ? source : { ...task, id: 'created' }) as T);
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component.draft.requirements = 'Furnish all floors';
    await component.createTask();
    expect(api.request).toHaveBeenCalledWith('POST', '/projects/project/builds', {
      worldFileId: 'z', xml: '<building version="3"><floor/></building>'
    });
    expect(api.request).toHaveBeenCalledWith('POST', '/projects/project/tasks', jasmine.objectContaining({
      sourceBuildId: 'pinned', type: 'furnish', requirements: 'Furnish all floors'
    }));
    expect(navigate).toHaveBeenCalledWith(['/projects', 'project', 'tasks', 'created']);
  });

  it('retains the brief and reuses a pinned building when task creation fails and is retried', async () => {
    taskId = null; configure('owner');
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    await component.loadWorldBuildings();
    component.taskFromBuilding(cloud.files[0]);
    component.builds = [{ id: 'pinned', projectId: 'project', name: 'hall', revisionId: 'revision', worldFileId: 'z' }];
    api.request.and.rejectWith(new Error('Task request failed'));
    await component.createTask();
    expect(component.draftWorldBuilding?.id).toBe('z');
    expect(component.draft.title).toBe('Furnish hall');
    expect(component.error).toContain('Task request failed');
    expect(worlds.file).not.toHaveBeenCalled();
    expect(api.request.calls.allArgs().every(args => args[1].endsWith('/tasks'))).toBeTrue();
  });

  it('reports unavailable worlds without breaking the task list', async () => {
    taskId = null; configure();
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    worlds.world.and.rejectWith(new Error('Only invited project members can access the hosted world.'));
    await component.loadWorldBuildings();
    expect(component.buildingsError).toContain('Only invited');
    expect(component.tasks).toEqual([task]);
    expect(component.worldBuildings).toEqual([]);
  });

  it('tile details show a brief alongside external references, with a visible failure fallback', async () => {
    taskId = 'task'; configure();
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    fixture.componentInstance.imageFailed(task.references[0]);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Two directions');
    expect(text).toContain('This image cannot be embedded');
    const source: HTMLAnchorElement = fixture.nativeElement.querySelector('figcaption a');
    expect(source.href).toBe('https://example.test/page');
    expect(source.rel).toContain('noreferrer');
  });

  it('review actions are unavailable to contributors even for submitted work', async () => {
    taskId = 'task'; configure();
    const item: Contribution = { id: 'item', projectId: 'project', taskId: 'task', originalBuildId: null, sourceRevisionId: null,
      createdBy: 'other', name: 'Sign', status: 'submitted', revision: 2, deliverableUrl: 'https://example.test/sign.zip', reviewNote: '' };
    api.contributions.and.resolveTo([item]);
    const fixture = TestBed.createComponent(ProjectWorkspaceComponent);
    fixture.detectChanges(); await fixture.whenStable();
    fixture.componentInstance.imageFailed(task.references[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('View tile deliverable');
    expect(fixture.nativeElement.textContent).not.toContain('Approve');
  });
});
