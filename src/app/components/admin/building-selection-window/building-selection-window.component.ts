import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subject, takeUntil } from 'rxjs';
import * as fromRoot from '../../../app.reducers';
import { BuildingService } from '../../../services/building.service';
import { ApiService } from '../../../services/api.service';
import { TogglePopup } from '../../../app.actions';

interface ProjectBuilding { id: string; Name: string; Contents: string; }

@Component({
  selector: 'app-building-selection-window',
  templateUrl: './building-selection-window.component.html',
  styleUrls: ['./building-selection-window.component.scss']
})
export class BuildingSelectionWindowComponent implements OnInit, OnDestroy {
  @ViewChild('setupDialog') setupDialog: ElementRef<HTMLDialogElement>;
  readonly openBuilding$ = this.store.select(fromRoot.getBuilding);
  readonly forceShowWindow$ = this.store.select(fromRoot.isPopupOpen('main-menu'));
  private readonly destroyed$ = new Subject<void>();
  readonly presets = [
    { name: 'Small', width: 16, height: 16 },
    { name: 'House', width: 24, height: 20 },
    { name: 'Store', width: 32, height: 24 }
  ];
  buildings: ProjectBuilding[] = [];
  listBuildings = false;
  showWindow = true;
  templateNames: string[] = [];
  selectedTemplateName = '';
  showTemplatePicker = false;
  showAllTemplates = false;
  loadingProjects = true;
  projectError = '';
  error = '';
  busy = false;
  dragging = false;
  search = '';
  width = 24;
  height = 20;

  constructor(private buildingService: BuildingService, private store: Store<fromRoot.State>,
              private apiService: ApiService, private changeDetector: ChangeDetectorRef) { }

  ngOnInit(): void {
    void this.getBuildingsByProjectName('ThamesValley');
    this.openBuilding$.pipe(takeUntil(this.destroyed$)).subscribe(building => {
      if (building) this.closeWindow();
    });
    void this.buildingService.getTemplateNames().then(names => {
      this.templateNames = names;
      this.selectedTemplateName = names[0] || '';
    }).catch(() => { this.error = 'Could not load the starter templates. You can still create an empty canvas.'; });
  }

  ngOnDestroy(): void { this.destroyed$.next(); this.destroyed$.complete(); }
  get filteredBuildings(): ProjectBuilding[] {
    return this.buildings.filter(building => building.Name.toLowerCase().includes(this.search.trim().toLowerCase()));
  }
  get showProject(): boolean { return 'thames valley'.includes(this.search.trim().toLowerCase()); }
  get validDimensions(): boolean {
    return Number.isInteger(this.width) && Number.isInteger(this.height) &&
      this.width >= 1 && this.width <= 256 && this.height >= 1 && this.height <= 256;
  }
  async getBuildingsByProjectName(projectName: string): Promise<void> {
    this.loadingProjects = true;
    this.projectError = '';
    try {
      const result = await this.apiService.getBuildingsByProjectName(projectName);
      this.buildings = Array.isArray(result) ? result : [];
    } catch {
      this.projectError = 'Could not load the project buildings. Check your connection and try again.';
    } finally { this.loadingProjects = false; }
  }
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
  async openProjectBuilding(building: ProjectBuilding): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try { await this.loadBuilding(building.Contents); }
    catch (error) { this.reportError(error); }
    finally { this.busy = false; }
  }
  private reportError(error: unknown): void { this.error = error instanceof Error ? error.message : String(error); }
  closeWindow(): void { this.showWindow = false; this.store.dispatch(new TogglePopup('main-menu', false)); }
}
