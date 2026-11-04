import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import * as fromRoot from '../../../app.reducers';
import { BuildingService } from '../../../services/building.service';
import { ProjectApiService } from '../../../services/project-api.service';
import { AuthService } from '../../../services/auth.service';
import { Project } from '../../../models/project.models';
import { Router } from '@angular/router';

@Component({
  selector: 'app-building-selection-window',
  templateUrl: './building-selection-window.component.html',
  styleUrls: ['./building-selection-window.component.scss']
})
export class BuildingSelectionWindowComponent implements OnInit, OnDestroy {
  @ViewChild('setupDialog') setupDialog: ElementRef<HTMLDialogElement>;
  readonly openBuilding$ = this.store.select(fromRoot.getBuilding);
  private readonly destroyed$ = new Subject<void>();
  readonly presets = [
    { name: 'Small', width: 16, height: 16 },
    { name: 'House', width: 24, height: 20 },
    { name: 'Store', width: 32, height: 24 }
  ];
  projects: Project[] = [];
  projectName = '';
  projectDescription = '';
  projectVisibility: 'private' | 'public' = 'private';
  creatingProject = false;
  hasStandaloneRecovery = false;
  templateNames: string[] = [];
  selectedTemplateName = '';
  showTemplatePicker = false;
  showAllTemplates = false;
  loadingProjects = false;
  projectError = '';
  error = '';
  busy = false;
  dragging = false;
  search = '';
  width = 24;
  height = 20;

  constructor(private buildingService: BuildingService, private store: Store<fromRoot.State>,
              private apiService: ProjectApiService, private changeDetector: ChangeDetectorRef,
              public auth: AuthService, private router: Router) { }

  ngOnInit(): void {
    try { this.hasStandaloneRecovery = !!localStorage.getItem('buildingXml'); }
    catch (error) {
      this.error = 'Browser storage is unavailable; local drafts cannot be restored.';
      console.error(this.error, error);
    }
    this.auth.user$.pipe(takeUntil(this.destroyed$)).subscribe(user => {
      this.projects = [];
      if (user) void this.loadProjects();
    });
    void this.buildingService.getTemplateNames().then(names => {
      this.templateNames = names;
      this.selectedTemplateName = names[0] || '';
    }).catch(() => { this.error = 'Could not load the starter templates. You can still create an empty canvas.'; });
  }

  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }
  get filteredProjects(): Project[] {
    return this.projects.filter(project => project.name.toLowerCase().includes(this.search.trim().toLowerCase()));
  }
  get validDimensions(): boolean {
    return Number.isInteger(this.width) && Number.isInteger(this.height) &&
      this.width >= 1 && this.width <= 256 && this.height >= 1 && this.height <= 256;
  }
  async loadProjects(): Promise<void> {
    const uid = this.auth.user?.uid;
    if (!uid) return;
    this.loadingProjects = true;
    this.projectError = '';
    try {
      const result = await this.apiService.projects();
      if (this.auth.user?.uid === uid) this.projects = result;
    } catch (error) {
      this.projectError = error instanceof Error ? error.message : String(error);
    } finally { this.loadingProjects = false; }
  }
  async createProject(): Promise<void> {
    if (this.creatingProject || !this.projectName.trim()) return;
    this.creatingProject = true;
    this.projectError = '';
    try {
      const project = await this.apiService.request<Project>('POST', '/projects', {
        name: this.projectName, description: this.projectDescription, visibility: this.projectVisibility
      });
      await this.router.navigate(['/projects', project.id]);
    } catch (error) { this.projectError = error instanceof Error ? error.message : String(error); }
    finally { this.creatingProject = false; }
  }
  async signOut(): Promise<void> {
    try { await this.auth.signOut(); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); }
  }
  resumeEditor(): void { void this.router.navigate(['/editor']); }
  selectPreset(width: number, height: number): void { this.width = width; this.height = height; }
  openTemplatePicker(name?: string): void {
    if (name) this.selectedTemplateName = name;
    this.openDialog('template');
  }
  openDialog(kind: 'template' | 'docs'): void {
    this.showTemplatePicker = kind === 'template';
    this.changeDetector.detectChanges();
    this.setupDialog.nativeElement.showModal();
  }
  closeDialog(): void {
    this.setupDialog?.nativeElement.close();
    this.showTemplatePicker = false;
  }
  onDialogClick(event: MouseEvent): void {
    if (event.target !== this.setupDialog.nativeElement) return;
    const rect = this.setupDialog.nativeElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closeDialog();
  }
  async createNewBuilding(): Promise<void> {
    if (this.busy || !this.validDimensions) return;
    this.busy = true;
    this.error = '';
    try {
      await this.buildingService.createNewBuilding(this.selectedTemplateName, { width: this.width, height: this.height });
      this.closeDialog();
      this.closeWindow();
    } catch (error) { this.reportError(error); }
    finally { this.busy = false; }
  }
  async handleFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.openFile(file);
    input.value = '';
  }
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragging = true;
  }
  onDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) this.dragging = false;
  }
  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) await this.openFile(file);
  }
  private async openFile(file: File): Promise<void> {
    if (this.busy) return;
    if (!/\.tbx$/i.test(file.name)) { this.error = 'Choose a .tbx building file.'; return; }
    this.busy = true;
    this.error = '';
    try { await this.loadBuilding(await file.text()); }
    catch (error) { this.reportError(error); }
    finally { this.busy = false; }
  }
  async loadBuilding(xml: string): Promise<void> {
    await this.buildingService.createBuildingFromXml(new DOMParser().parseFromString(xml, 'text/xml'));
    this.closeWindow();
  }
  private reportError(error: unknown): void { this.error = error instanceof Error ? error.message : String(error); }
  closeWindow(): void { void this.router.navigate(['/editor']); }
}
