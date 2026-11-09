import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, combineLatest, takeUntil } from 'rxjs';
import { Contribution, Project, ProjectBuild, ProjectMember, ProjectTask, TaskReference } from '../../models/project.models';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';
import { ProjectWorldDocument, ProjectWorldFile, ProjectWorldService } from '../../services/project-world.service';
import { BuildingPreviewService } from '../../services/building-preview.service';
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
  showTaskForm = false;
  view: 'tasks' | 'buildings' = 'tasks';
  worldBuildings: ProjectWorldFile[] = [];
  worldCatalog?: ProjectWorldDocument | null;
  buildingsLoading = false;
  buildingsError = '';
  buildingSearch = '';
  buildingPage = 0;
  readonly buildingPageSize = 50;
  draftWorldBuilding?: ProjectWorldFile;
  previewBuilding?: ProjectWorldFile;
  previewUrl = '';
  previewWarnings: string[] = [];
  previewLoading = false;
  previewError = '';
  private previewGeneration = 0;
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

  constructor(private route: ActivatedRoute, private router: Router, public auth: AuthService, private api: ProjectApiService,
    private worlds: ProjectWorldService, private previews: BuildingPreviewService) { }
  get canManage(): boolean { return this.auth.isAdmin && (this.project?.role === 'owner' || this.project?.role === 'reviewer'); }
  get accepting(): boolean { return !!this.task && (this.task.type === 'furnish' || this.auth.canViewWorlds) && ['available', 'review_pending'].includes(this.task.status); }
  get filteredTasks(): ProjectTask[] {
    return this.tasks.filter(task => (task.type === 'furnish' || this.auth.canViewWorlds) && task.title.toLowerCase().includes(this.search.trim().toLowerCase()) &&
      (this.statusFilter === 'all' || (this.statusFilter === 'pending'
        ? ['available', 'review_pending'].includes(task.status) : task.status === this.statusFilter)));
  }
  get filteredBuildings(): ProjectWorldFile[] {
    const search = this.buildingSearch.trim().toLowerCase();
    return this.worldBuildings.filter(building => building.path.toLowerCase().includes(search));
  }
  get visibleBuildings(): ProjectWorldFile[] {
    return this.filteredBuildings.slice(this.buildingPage * this.buildingPageSize, (this.buildingPage + 1) * this.buildingPageSize);
  }
  get buildingPages(): number { return Math.max(1, Math.ceil(this.filteredBuildings.length / this.buildingPageSize)); }
  buildingTasks(building: ProjectWorldFile): ProjectTask[] {
    const sources = new Set(this.builds.filter(build => build.worldFileId === building.id).map(build => build.id));
    return this.tasks.filter(task => !!task.sourceBuildId && sources.has(task.sourceBuildId));
  }

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.auth.user$]).pipe(takeUntil(this.destroyed$)).subscribe(([, user]) => {
      if (!user) {
        this.generation++;
        this.project = undefined;
        this.task = undefined;
        this.tasks = [];
        this.contributions = [];
        this.clearBuildings();
        void this.router.navigate(['/']);
      } else { void this.load(); }
    });
  }
  ngOnDestroy(): void { this.generation++; this.closeBuildingPreview(); this.destroyed$.next(); this.destroyed$.complete(); }

  async load(): Promise<void> {
    const generation = ++this.generation;
    const projectId = this.route.snapshot.paramMap.get('projectId')!;
    const taskId = this.route.snapshot.paramMap.get('taskId');
    this.loading = true;
    this.error = '';
    this.clearBuildings();
    this.cancelTaskForm();
    this.view = this.auth.canViewWorlds && this.route.snapshot.queryParamMap?.get('view') === 'buildings' ? 'buildings' : 'tasks';
    try {
      const [project, builds, tasks] = await Promise.all([
        this.api.project(projectId), this.api.builds(projectId), this.api.tasks(projectId)
      ]);
      const [task, contributions, members] = await Promise.all([
        taskId ? this.api.task(taskId) : Promise.resolve(undefined),
        taskId ? this.api.contributions(taskId) : Promise.resolve([]),
        this.auth.isAdmin && project.role === 'owner' ? this.api.members(projectId) : Promise.resolve([])
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
      if (!task && this.view === 'buildings') await this.loadWorldBuildings();
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
    } finally { if (generation === this.generation) this.loading = false; }
  }

  selectView(view: 'tasks' | 'buildings'): void {
    if (view === 'buildings' && !this.auth.canViewWorlds) return;
    this.view = view;
    if (view === 'buildings' && this.worldCatalog === undefined) void this.loadWorldBuildings();
  }
  private clearBuildings(): void {
    this.worldBuildings = [];
    this.worldCatalog = undefined;
    this.buildingsLoading = false;
    this.buildingsError = '';
    this.buildingSearch = '';
    this.buildingPage = 0;
    this.closeBuildingPreview();
  }
  async loadWorldBuildings(): Promise<void> {
    if (!this.auth.canViewWorlds || !this.project || this.buildingsLoading) return;
    const generation = this.generation;
    const projectId = this.project.id;
    this.buildingsLoading = true;
    this.buildingsError = '';
    try {
      const world = await this.worlds.world(projectId);
      if (generation !== this.generation) return;
      this.worldCatalog = world;
      this.worldBuildings = (world?.files ?? []).filter(file => /\.tbx$/i.test(file.path))
        .sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true, sensitivity: 'base' }) || a.path.localeCompare(b.path, 'en'));
      this.buildingPage = 0;
      this.closeBuildingPreview();
    } catch (error) {
      if (generation === this.generation) {
        this.worldCatalog = undefined;
        this.worldBuildings = [];
        this.buildingsError = error instanceof Error ? error.message : String(error);
      }
    } finally { if (generation === this.generation) this.buildingsLoading = false; }
  }
  closeBuildingPreview(): void {
    this.previewGeneration++;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = '';
    this.previewBuilding = undefined;
    this.previewWarnings = [];
    this.previewLoading = false;
    this.previewError = '';
  }
  async viewBuilding(building: ProjectWorldFile): Promise<void> {
    if (!this.worldCatalog) return;
    this.closeBuildingPreview();
    const generation = this.previewGeneration;
    this.previewBuilding = building;
    this.previewLoading = true;
    try {
      const file = await this.worlds.file(this.worldCatalog, building);
      const preview = await this.previews.preview(file, 0, 1024);
      if (generation !== this.previewGeneration) return;
      this.previewUrl = URL.createObjectURL(preview.blob);
      this.previewWarnings = preview.warnings;
    } catch (error) {
      if (generation === this.previewGeneration) this.previewError = error instanceof Error ? error.message : String(error);
    } finally { if (generation === this.previewGeneration) this.previewLoading = false; }
  }
  taskFromBuilding(building: ProjectWorldFile): void {
    if (!this.canManage || this.busy) return;
    this.draftWorldBuilding = building;
    this.draft = { ...emptyTask(), title: `Furnish ${building.path.split('/').pop()!.replace(/\.tbx$/i, '')}`.slice(0, 200),
      description: `Furnish the building at ${building.path}.` };
    this.showTaskForm = true;
    this.view = 'tasks';
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

  async createTask(): Promise<void> {
    await this.run(async () => {
      const generation = this.generation;
      const projectId = this.project!.id;
      if (this.draft.type === 'furnish' && this.draftWorldBuilding) {
        if (!this.worldCatalog) throw new Error('Refresh the world building list before creating a task.');
        const entry = this.draftWorldBuilding;
        let source = this.builds.find(build => build.worldFileId === entry.id);
        if (!source) {
          const file = await this.worlds.file(this.worldCatalog, entry);
          const xml = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer());
          if (generation !== this.generation) return;
          source = await this.api.request<ProjectBuild>('POST', `/projects/${projectId}/builds`, { worldFileId: entry.id, xml });
          if (generation !== this.generation) return;
          this.builds = [...this.builds, source];
        }
        this.draft.sourceBuildId = source.id;
      }
      const task = await this.api.request<ProjectTask>('POST', `/projects/${projectId}/tasks`, this.draft);
      if (generation !== this.generation) return;
      this.draft = emptyTask();
      this.draftWorldBuilding = undefined;
      this.showTaskForm = false;
      await this.router.navigate(['/projects', projectId, 'tasks', task.id]);
    });
  }
  cancelTaskForm(): void {
    this.editingBrief = false;
    this.showTaskForm = false;
    this.draftWorldBuilding = undefined;
    this.draft = { ...emptyTask(), sourceBuildId: this.builds[0]?.id || '' };
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
