import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { BuildingPreviewService } from '../../services/building-preview.service';
import { BuildingPreview } from '../../utils/building-preview';
import { readBuildingPreviewFile } from '../../utils/tbx-format';

export interface TilezedBuildingChoice {
  path: string; file: File; width: number; height: number;
}
interface BuildingEntry {
  path: string; file: File; url?: string; choice?: TilezedBuildingChoice; preview?: BuildingPreview; error?: string;
}

@Component({
  selector: 'app-tilezed-building-palette', standalone: true, imports: [CommonModule],
  templateUrl: './tilezed-building-palette.component.html', styleUrls: ['./tilezed-building-palette.component.scss'],
})
export class TilezedBuildingPaletteComponent implements OnChanges, OnDestroy {
  @Input() files: ReadonlyMap<string, File> = new Map();
  @Input() disabled = false;
  @Output() buildingChange = new EventEmitter<TilezedBuildingChoice>();
  search = '';
  page = 0;
  entries: BuildingEntry[] = [];
  selected?: BuildingEntry;
  private paths: string[] = [];
  private generation = 0;
  private readonly changes?: Subscription;
  readonly pageSize = 8;
  get matches(): string[] { const search = this.search.trim().toLowerCase(); return this.paths.filter(path => path.toLowerCase().includes(search)); }
  get pageCount(): number { return Math.max(1, Math.ceil(this.matches.length / this.pageSize)); }

  constructor(private readonly previews: BuildingPreviewService, private readonly zone: NgZone) {
    this.changes = this.previews.sheetChanges$?.subscribe(() => { this.release(); this.selected = undefined; this.showPage(); });
  }
  ngOnChanges(changes: Record<string, unknown>): void {
    if (!changes['files']) return;
    this.release(); this.selected = undefined;
    this.paths = [...this.files.keys()].filter(path => /\.tbx$/i.test(path)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    this.page = 0; this.showPage();
  }
  filter(value: string): void { this.search = value; this.page = 0; this.showPage(); }
  turnPage(delta: number): void { this.page = Math.max(0, Math.min(this.pageCount - 1, this.page + delta)); this.showPage(); }
  select(entry: BuildingEntry): void {
    if (!entry.choice || this.disabled) return;
    if (this.selected && !this.entries.includes(this.selected) && this.selected.url) URL.revokeObjectURL(this.selected.url);
    this.selected = entry; this.buildingChange.emit(entry.choice);
  }
  private showPage(): void {
    const generation = ++this.generation;
    this.release(false);
    this.entries = this.matches.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize).map(path => ({ path, file: this.files.get(path)! }));
    // Only the visible page is rendered; the shared preview service limits concurrent jobs and caches results.
    for (const entry of this.entries) void this.load(entry, generation);
  }
  private async load(entry: BuildingEntry, generation: number): Promise<void> {
    try {
      if (entry.file.size > 4 * 1024 * 1024) throw new Error('Building files larger than 4 MiB are not supported.');
      const building = readBuildingPreviewFile(new DOMParser().parseFromString(await entry.file.text(), 'application/xml'));
      if (generation !== this.generation) return;
      const preview = await this.previews.preview(entry.file, 0, 384);
      if (generation !== this.generation) return;
      this.zone.run(() => {
        entry.preview = preview; entry.url = URL.createObjectURL(preview.blob);
        entry.choice = { path: entry.path, file: entry.file, width: building.width, height: building.height };
      });
    } catch (error) {
      if (generation === this.generation) this.zone.run(() => { entry.error = error instanceof Error ? error.message : String(error); });
    }
  }
  private release(includeSelected = true): void {
    const entries = new Set([...this.entries, ...(includeSelected && this.selected ? [this.selected] : [])]);
    for (const entry of entries) if (entry.url && (includeSelected || entry !== this.selected)) URL.revokeObjectURL(entry.url);
  }
  ngOnDestroy(): void { this.generation++; this.changes?.unsubscribe(); this.release(); }
}
