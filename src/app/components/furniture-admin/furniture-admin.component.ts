import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { DbService } from '../../services/db.service';
import { FurnitureLibraryService } from '../../services/furniture-library.service';
import { TileAdminService } from '../../services/tile-admin.service';
import { BFurniture, BFurnitureGroup } from '../../models/furniture-window.models';
import { FURNITURE_LAYERS, parseFurnitureDocument } from '../../utils/furniture-catalog-parser';
import { parseTileName } from '../../utils/sheet-atlas';
import {
  BASIC_ORIENTS, FurnitureOrient, SEQUENCES, SequenceName, clearEntry, dropTiles, entryOf, fillSequential, insertAt, move, orientsOf, removeAt, setGrime, setLayer, setTile,
  toggleCorners, updateFurniture, updateGroup, validCategoryLabel,
} from '../../utils/furniture-editing';
import { FURNITURE_TILE_MIME, FurnitureCellDrop, FurnitureCellPoint } from './furniture-cell.component';

interface Snapshot { groups: BFurnitureGroup[]; group: number; furniture: number; orient: string; }
interface BrowserTile { name: string; url: string; }
const MAX_UNDO = 200;

/** Admin-only port of the furniture half of the desktop "Tiles" dialog (BuildingTilesDialog). */
@Component({
  selector: 'app-furniture-admin',
  templateUrl: './furniture-admin.component.html',
  styleUrls: ['./furniture-admin.component.scss'],
})
export class FurnitureAdminComponent implements OnInit, OnDestroy {
  readonly layers = FURNITURE_LAYERS;
  readonly scales = [.35, .5, .75, 1];
  readonly orientsOf = orientsOf;
  readonly entryOf = entryOf;

  groups: BFurnitureGroup[] = [];
  group = 0;
  furniture = 0;
  orient = 'W';
  scale = Number(localStorage.getItem('furnitureAdminScale')) || .5;

  loading = true;
  saving = false;
  error = '';
  notice = '';
  unpublished = false;
  private revision = 0;
  private sourceRevision = 0;
  private generation = 0;
  private savedGroups: BFurnitureGroup[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  renaming: number | null = null;
  renameText = '';
  @ViewChild('renameInput') renameInput?: ElementRef<HTMLInputElement>;

  tilesets: string[] = [];
  tilesetFilter = '';
  tileset = localStorage.getItem('furnitureAdminTileset') || '';
  tiles: BrowserTile[] = [];
  selectedTiles = new Set<string>();
  private anchorTile: string | null = null;
  private tileRequest = 0;
  private bitmaps = new Map<string, Promise<ImageBitmap | null>>();

  constructor(private tileAdmin: TileAdminService, private library: FurnitureLibraryService, private db: DbService, public auth: AuthService) { }

  ngOnInit(): void {
    void this.load();
    void this.loadTilesets();
  }

  ngOnDestroy(): void {
    this.tileRequest++;
    this.releaseBitmaps(new Set());
  }

  get dirty(): boolean { return this.groups !== this.savedGroups; }
  get canUndo(): boolean { return !!this.undoStack.length; }
  get canRedo(): boolean { return !!this.redoStack.length; }
  get currentGroup(): BFurnitureGroup | undefined { return this.groups[this.group]; }
  get current(): BFurniture | undefined { return this.currentGroup?.furniture[this.furniture]; }
  get layer(): string { return this.current?.layer || 'Furniture'; }
  get grime(): boolean { return this.current ? entryOf(this.current, this.orient)?.grime !== false : true; }
  get filteredTilesets(): string[] {
    const filter = this.tilesetFilter.trim().toLowerCase();
    return filter ? this.tilesets.filter(name => name.toLowerCase().includes(filter)) : this.tilesets;
  }

  /** Bound for child cells; shares decoded tiles between them. */
  readonly image = (name: string): Promise<ImageBitmap | null> => {
    let request = this.bitmaps.get(name);
    if (!request) {
      request = this.db.getTileBitmap(name).catch(() => null);
      this.bitmaps.set(name, request);
    }
    return request;
  };

  async load(): Promise<void> {
    this.loading = true;
    this.error = this.notice = '';
    try {
      const published = await this.tileAdmin.getFurniture();
      this.unpublished = published.text === null;
      const text = published.text ?? await this.library.bundledText();
      const document = parseFurnitureDocument(text);
      this.generation = published.generation;
      this.revision = document.revision;
      this.sourceRevision = document.sourceRevision;
      this.groups = this.savedGroups = document.groups;
      this.undoStack = [];
      this.redoStack = [];
      this.selectGroup(Math.min(this.group, Math.max(0, this.groups.length - 1)));
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.loading = false;
    }
  }

  async reload(): Promise<void> {
    if (this.dirty && !confirm('Discard your unsaved furniture changes and load the published list?')) return;
    await this.load();
  }

  async save(): Promise<void> {
    if (this.saving || this.loading || (!this.dirty && !this.unpublished)) return;
    this.saving = true;
    this.error = this.notice = '';
    const groups = this.groups;
    try {
      const result = await this.tileAdmin.saveFurniture({ revision: this.revision + 1, sourceRevision: this.sourceRevision, groups }, this.generation);
      this.generation = result.generation;
      this.revision = result.revision;
      this.savedGroups = groups;
      this.unpublished = false;
      this.notice = `Published revision ${result.revision}. Open editors pick it up when they regain focus.`;
      await this.library.published().catch(() => { /* Other tabs still catch up on their next check. */ });
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.saving = false;
    }
  }

  canLeave(): boolean {
    return !this.dirty || confirm('You have unsaved furniture changes. Leave without saving?');
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); void this.save(); return; }
    // Leave text fields their own undo.
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); this.undo(); }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); this.redo(); }
  }

  // History

  private snapshot(): Snapshot {
    return { groups: this.groups, group: this.group, furniture: this.furniture, orient: this.orient };
  }

  private restore(snapshot: Snapshot): void {
    this.groups = snapshot.groups;
    this.group = snapshot.group;
    this.furniture = snapshot.furniture;
    this.orient = snapshot.orient;
    this.renaming = null;
    this.pruneBitmaps();
  }

  private commit(groups: BFurnitureGroup[], selection: Partial<Omit<Snapshot, 'groups'>> = {}): void {
    if (groups === this.groups) return;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.restore({ ...this.snapshot(), ...selection, groups });
    this.notice = '';
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(this.snapshot());
    this.restore(snapshot);
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(this.snapshot());
    this.restore(snapshot);
  }

  // Categories

  selectGroup(index: number): void {
    if (index !== this.group) this.renaming = null;
    this.group = index;
    this.furniture = 0;
    this.orient = 'W';
    this.pruneBitmaps();
  }

  newCategory(): void {
    const index = this.groups.length ? this.group + 1 : 0;
    this.commit(insertAt(this.groups, index, { label: 'New Category', furniture: [] }), { group: index, furniture: 0, orient: 'W' });
    this.startRename(index);
  }

  removeCategory(): void {
    const group = this.currentGroup;
    if (!group) return;
    if (group.furniture.length && !confirm(`Remove "${group.label}" and its ${group.furniture.length} furniture items?`)) return;
    this.commit(removeAt(this.groups, this.group), { group: Math.max(0, Math.min(this.group, this.groups.length - 2)), furniture: 0, orient: 'W' });
  }

  moveCategory(delta: number): void {
    const to = this.group + delta;
    this.commit(move(this.groups, this.group, to), { group: to });
  }

  startRename(index: number): void {
    this.renaming = index;
    this.renameText = this.groups[index]?.label ?? '';
    setTimeout(() => { this.renameInput?.nativeElement.focus(); this.renameInput?.nativeElement.select(); });
  }

  finishRename(): void {
    const index = this.renaming;
    if (index === null) return;
    this.renaming = null;
    const label = this.renameText.trim();
    if (!validCategoryLabel(label)) {
      if (label) this.error = 'Category names must be up to 100 characters without line breaks, braces or "//".';
      return;
    }
    this.commit(updateGroup(this.groups, index, group => group.label === label ? group : { ...group, label }));
  }

  cancelRename(): void { this.renaming = null; }

  // Furniture

  select(furniture: number, orient: string): void {
    this.furniture = furniture;
    this.orient = orient;
  }

  private editCurrent(update: (furniture: BFurniture) => BFurniture, furniture = this.furniture, orient = this.orient): void {
    this.commit(updateFurniture(this.groups, this.group, furniture, update), { furniture, orient });
  }

  addFurniture(): void {
    const group = this.currentGroup;
    if (!group) return;
    const index = group.furniture.length ? this.furniture + 1 : 0;
    this.commit(updateGroup(this.groups, this.group, g => ({ ...g, furniture: insertAt(g.furniture, index, { entries: [] }) })),
      { furniture: index, orient: 'W' });
  }

  removeFurniture(): void {
    const group = this.currentGroup;
    if (!this.current || !group) return;
    this.commit(updateGroup(this.groups, this.group, g => ({ ...g, furniture: removeAt(g.furniture, this.furniture) })),
      { furniture: Math.max(0, Math.min(this.furniture, group.furniture.length - 2)), orient: 'W' });
  }

  moveFurniture(delta: number): void {
    const to = this.furniture + delta;
    this.commit(updateGroup(this.groups, this.group, g => ({ ...g, furniture: move(g.furniture, this.furniture, to) })), { furniture: to });
  }

  fillSequential(furniture: number, sequence: SequenceName): void {
    this.editCurrent(item => fillSequential(item, SEQUENCES[sequence]), furniture, this.furniture === furniture ? this.orient : 'W');
  }

  clearTiles(): void { this.editCurrent(furniture => clearEntry(furniture, this.orient)); }

  toggleCorners(): void {
    const corners = !this.current?.corners;
    this.editCurrent(toggleCorners, this.furniture, corners || BASIC_ORIENTS.includes(this.orient as FurnitureOrient) ? this.orient : 'W');
  }

  setLayer(layer: string): void { this.editCurrent(furniture => setLayer(furniture, layer)); }

  setGrime(grime: boolean): void { this.editCurrent(furniture => setGrime(furniture, this.orient, grime)); }

  onDrop(furniture: number, orient: string, drop: FurnitureCellDrop): void {
    this.editCurrent(item => dropTiles(item, orient, drop.x, drop.y, drop.tiles), furniture, orient);
  }

  onClear(furniture: number, orient: string, point: FurnitureCellPoint): void {
    this.editCurrent(item => setTile(item, orient, point.x, point.y, null), furniture, orient);
  }

  trackIndex(index: number): number { return index; }

  // Tile browser

  async loadTilesets(): Promise<void> {
    try {
      this.tilesets = (await this.db.getTilesets()).map(tileset => tileset.name).sort((a, b) => a.localeCompare(b));
      if (!this.tilesets.includes(this.tileset)) this.tileset = this.tilesets[0] ?? '';
      if (this.tileset) await this.selectTileset(this.tileset);
    } catch {
      this.tilesets = [];
    }
  }

  async selectTileset(name: string): Promise<void> {
    const request = ++this.tileRequest;
    this.tileset = name;
    localStorage.setItem('furnitureAdminTileset', name);
    this.selectedTiles = new Set();
    this.anchorTile = null;
    const tiles = await this.db.getTiles(name);
    if (request !== this.tileRequest) return;
    this.tiles = tiles.map(tile => ({ name: tile.name.replace(/\.png$/i, ''), url: tile.url }));
  }

  clickTile(tile: BrowserTile, event: MouseEvent): void {
    const next = new Set(event.ctrlKey || event.metaKey || event.shiftKey ? this.selectedTiles : []);
    if (event.shiftKey && this.anchorTile) {
      const from = this.tiles.findIndex(item => item.name === this.anchorTile), to = this.tiles.indexOf(tile);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) if (i >= 0) next.add(this.tiles[i].name);
    } else if ((event.ctrlKey || event.metaKey) && next.has(tile.name)) {
      next.delete(tile.name);
    } else {
      next.add(tile.name);
      this.anchorTile = tile.name;
    }
    this.selectedTiles = next;
  }

  dragTile(tile: BrowserTile, event: DragEvent): void {
    if (!this.selectedTiles.has(tile.name)) {
      this.selectedTiles = new Set([tile.name]);
      this.anchorTile = tile.name;
    }
    const names = [...this.selectedTiles].sort((a, b) => (parseTileName(a)?.index ?? 0) - (parseTileName(b)?.index ?? 0));
    event.dataTransfer?.setData(FURNITURE_TILE_MIME, JSON.stringify(names));
    event.dataTransfer?.setData('text/plain', names.join('\n'));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  setScale(scale: number): void {
    this.scale = scale;
    localStorage.setItem('furnitureAdminScale', String(scale));
  }

  /** Frees decoded tiles that the shown category no longer uses. */
  private pruneBitmaps(): void {
    const keep = new Set<string>();
    for (const furniture of this.currentGroup?.furniture ?? []) {
      for (const entry of furniture.entries) for (const item of entry.items) keep.add(item.tile + '.png');
    }
    // Defer so cells for the previous category are destroyed before their bitmaps are closed.
    setTimeout(() => this.releaseBitmaps(keep));
  }

  private releaseBitmaps(keep: Set<string>): void {
    for (const [name, request] of this.bitmaps) {
      if (keep.has(name)) continue;
      this.bitmaps.delete(name);
      void request.then(bitmap => bitmap?.close());
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
