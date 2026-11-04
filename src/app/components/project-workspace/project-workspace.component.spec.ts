import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';
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
  const configure = (role: Project['role'] = 'contributor'): void => {
    api = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['project', 'tasks', 'builds', 'task', 'contributions', 'members', 'request']);
    api.project.and.resolveTo({ ...project, role });
    api.tasks.and.resolveTo([task]);
    api.builds.and.resolveTo([]);
    api.task.and.resolveTo(task);
    api.contributions.and.resolveTo([]);
    api.members.and.resolveTo([]);
    const params = convertToParamMap({ projectId: 'project', ...(taskId ? { taskId } : {}) });
    TestBed.configureTestingModule({
      declarations: [ProjectWorkspaceComponent], imports: [CommonModule, FormsModule, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: { user: { uid: 'user', displayName: 'Contributor' }, user$: of({ uid: 'user' }) } },
        { provide: ProjectApiService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: params }, paramMap: of(params) } }
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
