import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { Contribution, Project, ProjectBuild, ProjectMember, ProjectTask, TaskReference } from '../../models/project.models';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';
import { readBuildingFile, writeBuildingFile } from '../../utils/tbx-format';

type TaskDraft = Pick<ProjectTask, 'title' | 'type' | 'description' | 'requirements' | 'priority' | 'references'> & { sourceBuildId: string };
function emptyTask(): TaskDraft {
  return { title: '', type: 'furnish', description: '', requirements: '', priority: 'normal', sourceBuildId: '', references: [] };
}

@Component({
  selector: 'app-project-workspace',
  templateUrl: './project-workspace.component.html',
  styleUrls: ['./project-workspace.component.scss']
})
export class ProjectWorkspaceComponent implements OnInit, OnDestroy {
  project?: Project;
  tasks: ProjectTask[] = [];
  builds: ProjectBuild[] = [];
  members: ProjectMember[] = [];
  task?: ProjectTask;
  contributions: Contribution[] = [];
  loading = true;
  busy = false;
  error = '';
  message = '';
  search = '';
  statusFilter = 'pending';
  draft = emptyTask();
  editingBrief = false;
  memberEmail = '';
  memberRole: 'reviewer' | 'contributor' = 'contributor';
  buildName = '';
  contributionName = '';
  deliverableUrls: Record<string, string | undefined> = {};
  reviewNotes: Record<string, string | undefined> = {};
  private requestId = crypto.randomUUID();
  private failedImages = new Set<string>();
  private generation = 0;
  private readonly destroyed$ = new Subject<void>();

  constructor(private route: ActivatedRoute, private router: Router, public auth: AuthService, private api: ProjectApiService) { }
  get canManage(): boolean { return this.project?.role === 'owner' || this.project?.role === 'reviewer'; }
  get accepting(): boolean { return !!this.task && ['available', 'review_pending'].includes(this.task.status); }
  get filteredTasks(): ProjectTask[] {
    return this.tasks.filter(task => task.title.toLowerCase().includes(this.search.trim().toLowerCase()) &&
      (this.statusFilter === 'all' || (this.statusFilter === 'pending'
        ? ['available', 'review_pending'].includes(task.status) : task.status === this.statusFilter)));
  }

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.auth.user$]).pipe(takeUntil(this.destroyed$)).subscribe(([, user]) => {
      if (!user) {
        this.generation++;
        this.project = undefined;
        this.task = undefined;
        this.tasks = [];
        this.contributions = [];
        void this.router.navigate(['/']);
      } else { void this.load(); }
    });
  }
  ngOnDestroy(): void { this.generation++; this.destroyed$.next(); this.destroyed$.complete(); }

  async load(): Promise<void> {
    const generation = ++this.generation;
    const projectId = this.route.snapshot.paramMap.get('projectId')!;
    const taskId = this.route.snapshot.paramMap.get('taskId');
    this.loading = true;
    this.error = '';
    try {
      const [project, builds, tasks] = await Promise.all([
        this.api.project(projectId), this.api.builds(projectId), this.api.tasks(projectId)
      ]);
      const [task, contributions, members] = await Promise.all([
        taskId ? this.api.task(taskId) : Promise.resolve(undefined),
        taskId ? this.api.contributions(taskId) : Promise.resolve([]),
        project.role === 'owner' ? this.api.members(projectId) : Promise.resolve([])
      ]);
      if (generation !== this.generation) return;
      if (task && task.projectId !== projectId) throw new Error('This task belongs to a different project.');
      this.project = project;
      this.builds = builds;
      this.tasks = tasks;
      this.task = task;
      this.contributions = contributions;
      this.members = members;
      this.draft.sourceBuildId ||= builds[0]?.id || '';
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
    } finally { if (generation === this.generation) this.loading = false; }
  }

  async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = this.message = '';
    try { await action(); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; }
  }
  addReference(): void {
    if (this.draft.references.length < 12) this.draft.references.push({ imageUrl: '', sourceUrl: '', caption: '', alt: '' });
  }
  removeReference(index: number): void { this.draft.references.splice(index, 1); }
  imageFailed(reference: TaskReference): void { this.failedImages.add(reference.imageUrl); }
  imageUnavailable(reference: TaskReference): boolean { return this.failedImages.has(reference.imageUrl); }

  createTask(): void {
    void this.run(async () => {
      const task = await this.api.request<ProjectTask>('POST', `/projects/${this.project!.id}/tasks`, this.draft);
      this.draft = emptyTask();
      await this.router.navigate(['/projects', this.project!.id, 'tasks', task.id]);
    });
  }
  editBrief(): void {
    if (!this.task) return;
    this.draft = { title: this.task.title, type: this.task.type, description: this.task.description,
      requirements: this.task.requirements, priority: this.task.priority, sourceBuildId: this.task.sourceBuildId || '',
      references: this.task.references.map(reference => ({ ...reference })) };
    this.editingBrief = true;
  }
  updateTask(cancel = false): void {
    void this.run(async () => {
      const task = this.task!;
      this.task = await this.api.request<ProjectTask>('PUT', `/tasks/${task.id}`, {
        ...(this.editingBrief ? this.draft : task), revision: task.revision,
        status: cancel ? 'cancelled' : this.editingBrief ? task.status : 'available',
        reopen: !this.editingBrief && !cancel && ['completed', 'cancelled'].includes(task.status)
      });
      this.editingBrief = false;
      this.message = cancel ? 'Task cancelled.' : 'Task updated.';
    });
  }
  uploadBuild(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void this.run(async () => {
      if (!/\.tbx$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw new Error('Choose a TBX file of at most 8 MiB.');
      const building = readBuildingFile(new DOMParser().parseFromString(await file.text(), 'text/xml'));
      const xml = new XMLSerializer().serializeToString(writeBuildingFile(building));
      await this.api.request<ProjectBuild>('POST', `/projects/${this.project!.id}/builds`, {
        name: this.buildName.trim() || file.name.replace(/\.tbx$/i, ''), xml
      });
      this.buildName = '';
      await this.load();
      this.message = 'Original build added to the project.';
    });
  }
  changeVisibility(): void {
    void this.run(async () => {
      this.project = await this.api.request<Project>('PUT', `/projects/${this.project!.id}`, {
        visibility: this.project!.visibility === 'public' ? 'private' : 'public'
      });
      this.message = `Project is now ${this.project.visibility}.`;
    });
  }
  addMember(): void {
    void this.run(async () => {
      await this.api.request<ProjectMember>('POST', `/projects/${this.project!.id}/members`,
        { email: this.memberEmail, role: this.memberRole });
      this.memberEmail = '';
      await this.load();
      this.message = 'Project membership updated.';
    });
  }
  removeMember(member: ProjectMember): void {
    void this.run(async () => {
      await this.api.request('DELETE', `/members/${encodeURIComponent(member.id)}`);
      await this.load();
      this.message = 'Membership removed. Public projects remain accessible to all signed-in users.';
    });
  }
  startContribution(): void {
    void this.run(async () => {
      const contribution = await this.api.start(this.task!.id, this.contributionName, this.requestId);
      this.requestId = crypto.randomUUID();
      this.contributionName = '';
      if (this.task!.type === 'furnish') {
        await this.router.navigate(['/projects', this.project!.id, 'variants', contribution.id, 'edit']);
      } else {
        await this.load();
        this.message = 'Tile contribution draft created. Add an HTTPS deliverable link below when it is ready.';
      }
    });
  }
  submitTile(item: Contribution): void {
    void this.run(async () => {
      await this.api.submit(item.id, item.revision, this.deliverableUrls[item.id] || '');
      delete this.deliverableUrls[item.id];
      await this.load();
      this.message = 'Tile work submitted for review.';
    });
  }
  review(item: Contribution, status: 'approved' | 'changes_requested' | 'rejected'): void {
    void this.run(async () => {
      await this.api.request<Contribution>('POST', `/contributions/${item.id}/review`,
        { revision: item.revision, status, reviewNote: this.reviewNotes[item.id] || '' });
      delete this.reviewNotes[item.id];
      await this.load();
      this.message = 'Review recorded.';
    });
  }
  download(item: Contribution | ProjectBuild): void {
    void this.run(async () => {
      const path = 'taskId' in item ? `/contributions/${item.id}/document` : `/builds/${item.id}/document`;
      const result = await this.api.request<{ xml: string }>('GET', path);
      const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${item.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.tbx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }
}
