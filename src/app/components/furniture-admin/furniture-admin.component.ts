import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { DbService } from '../../services/db.service';
import { FurnitureLibraryService } from '../../services/furniture-library.service';
import { TileAdminService } from '../../services/tile-admin.service';
import { BFurniture, BFurnitureGroup } from '../../models/furniture-window.models';
import { FURNITURE_LAYERS, parseFurnitureDocument } from '../../utils/furniture-catalog-parser';
import { parseTileName } from '../../utils/sheet-atlas';
import {
  BASIC_ORIENTS, FurnitureOrient, SEQUENCES, SHIFT_STEPS, SequenceName, clearEntry, shiftTiles, dropTiles, entryOf, fillSequential, insertAt, move, orientsOf, removeAt, setGrime, setLayer, setTile,
  toggleCorners, updateFurniture, updateGroup, validCategoryLabel,
} from '../../utils/furniture-editing';
import { FURNITURE_TILE_MIME, FurnitureCellDrop, FurnitureCellPoint, furnitureTileDrag } from './furniture-cell.component';
import { BuildingTilesLibraryService } from '../../services/building-tiles-library.service';
import {
  BUILDING_TILE_CATEGORIES, BuildingTilesDocument, BuildingTilesEntry, BuildingTilesLayout, buildingTilesCategory, buildingTilesEntryKey,
  buildingTilesLayout, entryFromSingleTile, parseBuildingTilesDocument, setEntryOffset, setEntryTile, updateCategoryEntries,
} from '../../utils/building-tiles';

type AdminMode = 'furniture' | 'tiles';
interface Snapshot {
  groups: BFurnitureGroup[]; group: number; furniture: number; orient: string;
  tileDoc: BuildingTilesDocument | null; mode: AdminMode; tileCategory: string; tileEntry: number;
}
interface BrowserTile { name: string; url: string; }
const MAX_UNDO = 200;

/** Admin-only port of the desktop "Tiles" dialog (BuildingTilesDialog): building tile categories and furniture. */
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
  readonly shiftSteps = SHIFT_STEPS;
  readonly tileCategories = BUILDING_TILE_CATEGORIES;

  mode: AdminMode = localStorage.getItem('furnitureAdminMode') === 'tiles' ? 'tiles' : 'furniture';
  groups: BFurnitureGroup[] = [];
  group = 0;
  furniture = 0;
  orient = 'W';
  tileDoc: BuildingTilesDocument | null = null;
  tileCategory = buildingTilesCategory(localStorage.getItem('furnitureAdminTileCategory') ?? '')?.name ?? BUILDING_TILE_CATEGORIES[0].name;
  tileEntry = 0;
  scale = Number(localStorage.getItem('furnitureAdminScale')) || .5;

  loading = true;
  saving = false;
  error = '';
  notice = '';
  unpublished = false;
  tilesUnpublished = false;
  private revision = 0;
  private sourceRevision = 0;
  private generation = 0;
  private savedGroups: BFurnitureGroup[] = [];
  private tilesRevision = 0;
  private tilesGeneration = 0;
  private savedTileDoc: BuildingTilesDocument | null = null;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** `entry:slot` under a tile drag, or `new` for the add-entries drop zone. */
  dropTarget: string | null = null;

  renaming: number | null = null;
  renameText = '';
  @ViewChild('renameInput') renameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('furnitureScroll') furnitureScroll?: ElementRef<HTMLElement>;

  tilesets: string[] = [];
  private sheetSizes = new Map<string, number>();
  private sheetColumns = new Map<string, number>();
  private sprites = new Map<string, Record<string, string> | null>();
  private spriteScale = 0;
  private layoutCache?: { category: string; scale: number; layout: BuildingTilesLayout; styles: (Record<string, string> | null)[] };
  /** The slot whose offset the selected entry's offset fields edit. */
  tileSlot = '';
  tilesetFilter = '';
  tileset = localStorage.getItem('furnitureAdminTileset') || '';
  tiles: BrowserTile[] = [];
  selectedTiles = new Set<string>();
  private anchorTile: string | null = null;
  private tileRequest = 0;
  private bitmaps = new Map<string, Promise<ImageBitmap | null>>();

  constructor(private tileAdmin: TileAdminService, private library: FurnitureLibraryService, private db: DbService, public auth: AuthService,
    private tilesLibrary: BuildingTilesLibraryService) { }

  ngOnInit(): void {
    void this.load();
    void this.loadTilesets();
  }

  ngOnDestroy(): void {
    furnitureTileDrag.tiles = null;
    this.tileRequest++;
    this.releaseBitmaps(new Set());
  }

  get furnitureDirty(): boolean { return this.groups !== this.savedGroups; }
  get tilesDirty(): boolean { return this.tileDoc !== this.savedTileDoc; }
  get dirty(): boolean { return this.furnitureDirty || this.tilesDirty; }
  /** Publishing saves every edited list, or seeds the shown list if it was never published. */
  private get publishFurniture(): boolean { return this.furnitureDirty || (this.unpublished && this.mode === 'furniture'); }
  private get publishTiles(): boolean { return !!this.tileDoc && (this.tilesDirty || (this.tilesUnpublished && this.mode === 'tiles')); }
  get canPublish(): boolean { return !this.loading && !this.saving && (this.publishFurniture || this.publishTiles); }
  get shownUnpublished(): boolean { return this.mode === 'tiles' ? this.tilesUnpublished : this.unpublished; }
  get canUndo(): boolean { return !!this.undoStack.length; }
  get canRedo(): boolean { return !!this.redoStack.length; }
  get currentGroup(): BFurnitureGroup | undefined { return this.mode === 'furniture' ? this.groups[this.group] : undefined; }
  get current(): BFurniture | undefined { return this.currentGroup?.furniture[this.furniture]; }
  get tileDefinition() { return buildingTilesCategory(this.tileCategory)!; }
  /** The expert-mode grid of the shown category with each cell's template background, rebuilt when the category or zoom changes. */
  get tileLayout(): { layout: BuildingTilesLayout; styles: (Record<string, string> | null)[] } {
    const cached = this.layoutCache;
    if (cached?.category === this.tileCategory && cached.scale === this.scale) return cached;
    const layout = buildingTilesLayout(this.tileDefinition), scale = this.scale;
    const styles = layout.cells.map((cell): Record<string, string> | null => cell.template ? {
      'background-image': `url(${layout.image})`,
      'background-size': `${layout.columns * 128 * scale}px ${layout.rows * 256 * scale}px`,
      'background-position': `${-cell.column * 128 * scale}px ${-cell.row * 256 * scale}px`,
    } : null);
    this.layoutCache = { category: this.tileCategory, scale, layout, styles };
    return this.layoutCache;
  }
  get tileEntries(): BuildingTilesEntry[] { return this.tileDoc?.categories.find(category => category.name === this.tileCategory)?.entries ?? []; }
  get currentTileEntry(): BuildingTilesEntry | undefined { return this.mode === 'tiles' ? this.tileEntries[this.tileEntry] : undefined; }
  tileCount(name: string): number { return this.tileDoc?.categories.find(category => category.name === name)?.entries.length ?? 0; }
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
      const [published, tiles] = await Promise.all([this.tileAdmin.getFurniture(), this.tileAdmin.getBuildingTiles()]);
      this.unpublished = published.text === null;
      this.tilesUnpublished = tiles.text === null;
      const [text, tilesText] = await Promise.all([published.text ?? this.library.bundledText(), tiles.text ?? this.tilesLibrary.bundledText()]);
      const document = parseFurnitureDocument(text);
      const tileDoc = parseBuildingTilesDocument(tilesText);
      this.generation = published.generation;
      this.revision = document.revision;
      this.sourceRevision = document.sourceRevision;
      this.groups = this.savedGroups = document.groups;
      this.tilesGeneration = tiles.generation;
      this.tilesRevision = tileDoc.revision;
      this.tileDoc = this.savedTileDoc = tileDoc;
      this.undoStack = [];
      this.redoStack = [];
      this.tileEntry = Math.min(this.tileEntry, Math.max(0, this.tileEntries.length - 1));
      if (this.mode === 'furniture') this.selectGroup(Math.min(this.group, Math.max(0, this.groups.length - 1)));
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.loading = false;
    }
  }

  async reload(): Promise<void> {
    if (this.dirty && !confirm('Discard your unsaved changes and load the published lists?')) return;
    await this.load();
  }

  async save(): Promise<void> {
    if (!this.canPublish) return;
    this.saving = true;
    this.error = this.notice = '';
    const notices: string[] = [];
    try {
      if (this.publishTiles && this.tileDoc) {
        const tileDoc = this.tileDoc;
        const result = await this.tileAdmin.saveBuildingTiles({ ...tileDoc, revision: this.tilesRevision + 1 }, this.tilesGeneration);
        this.tilesGeneration = result.generation;
        this.tilesRevision = result.revision;
        this.savedTileDoc = tileDoc;
        this.tilesUnpublished = false;
        notices.push(`building tiles revision ${result.revision}`);
        await this.tilesLibrary.published().catch(() => { /* Other tabs still catch up on their next check. */ });
      }
      if (this.publishFurniture) {
        const groups = this.groups;
        const result = await this.tileAdmin.saveFurniture({ revision: this.revision + 1, sourceRevision: this.sourceRevision, groups }, this.generation);
        this.generation = result.generation;
        this.revision = result.revision;
        this.savedGroups = groups;
        this.unpublished = false;
        notices.push(`furniture revision ${result.revision}`);
        await this.library.published().catch(() => { /* Other tabs still catch up on their next check. */ });
      }
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.saving = false;
      if (notices.length) this.notice = `Published ${notices.join(' and ')}. Open editors pick it up when they regain focus.`;
    }
  }

  canLeave(): boolean {
    return !this.dirty || confirm('You have unsaved tile or furniture changes. Leave without saving?');
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
    if (key === 'd' && !event.shiftKey) { event.preventDefault(); if (this.mode === 'tiles') this.duplicateTileEntry(); else this.duplicateFurniture(); }
    else if (key === 'z' && !event.shiftKey) { event.preventDefault(); this.undo(); }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); this.redo(); }
  }

  // History

  private snapshot(): Snapshot {
    return {
      groups: this.groups, group: this.group, furniture: this.furniture, orient: this.orient,
      tileDoc: this.tileDoc, mode: this.mode, tileCategory: this.tileCategory, tileEntry: this.tileEntry,
    };
  }

  private restore(snapshot: Snapshot): void {
    this.groups = snapshot.groups;
    this.group = snapshot.group;
    this.furniture = snapshot.furniture;
    this.orient = snapshot.orient;
    this.tileDoc = snapshot.tileDoc;
    this.tileCategory = snapshot.tileCategory;
    this.tileEntry = snapshot.tileEntry;
    this.setMode(snapshot.mode);
    this.renaming = null;
    this.pruneBitmaps();
  }

  private commit(groups: BFurnitureGroup[], selection: Partial<Omit<Snapshot, 'groups'>> = {}): void {
    if (groups === this.groups) return;
    this.push({ ...this.snapshot(), mode: 'furniture', ...selection, groups });
  }

  private commitTiles(tileDoc: BuildingTilesDocument, selection: Partial<Omit<Snapshot, 'tileDoc'>> = {}): void {
    if (tileDoc === this.tileDoc) return;
    this.push({ ...this.snapshot(), mode: 'tiles', ...selection, tileDoc });
  }

  private push(next: Snapshot): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.restore(next);
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
    this.setMode('furniture');
    this.group = index;
    this.furniture = 0;
    this.orient = 'W';
    this.pruneBitmaps();
  }

  private setMode(mode: AdminMode): void {
    this.mode = mode;
    localStorage.setItem('furnitureAdminMode', mode);
    localStorage.setItem('furnitureAdminTileCategory', this.tileCategory);
  }

  selectTileCategory(name: string): void {
    this.renaming = null;
    if (name !== this.tileCategory || this.mode !== 'tiles') { this.tileEntry = 0; this.tileSlot = ''; }
    this.tileCategory = name;
    this.setMode('tiles');
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

  // Building tiles

  selectTileEntry(index: number): void { this.tileEntry = index; }

  private editTiles(update: (entries: BuildingTilesEntry[]) => BuildingTilesEntry[], tileEntry = this.tileEntry): void {
    if (!this.tileDoc) return;
    this.commitTiles(updateCategoryEntries(this.tileDoc, this.tileCategory, update), { tileCategory: this.tileCategory, tileEntry });
  }

  private editTileEntry(index: number, update: (entry: BuildingTilesEntry) => BuildingTilesEntry): void {
    this.editTiles(entries => {
      const next = update(entries[index]);
      if (next === entries[index]) return entries;
      const copy = entries.slice();
      copy[index] = next;
      return copy;
    }, index);
  }

  addBlankTileEntry(): void {
    const index = this.tileEntries.length ? this.tileEntry + 1 : 0;
    this.editTiles(entries => insertAt(entries, index, { tiles: {} }), index);
    this.scrollToRow('.tile-row', index);
  }

  /** Like dropping tiles on the desktop dialog's entry list: one entry per tile, skipping ones already listed. */
  addTileEntries(tiles: string[], at?: number): void {
    const keys = new Set(this.tileEntries.map(buildingTilesEntryKey));
    const created: BuildingTilesEntry[] = [];
    for (const tile of tiles) {
      const sheet = parseTileName(tile)?.sheet ?? '';
      const entry = entryFromSingleTile(this.tileCategory, tile, this.sheetColumns.get(sheet) ?? 8);
      const key = buildingTilesEntryKey(entry);
      if (keys.has(key)) continue;
      keys.add(key);
      created.push(entry);
    }
    const skipped = tiles.length - created.length;
    if (!created.length) {
      this.notice = `${tiles.length === 1 ? 'That tile is' : 'Those tiles are'} already in ${this.tileDefinition.label}.`;
      return;
    }
    const index = at ?? (this.tileEntries.length ? this.tileEntry + 1 : 0);
    this.editTiles(entries => [...entries.slice(0, index), ...created, ...entries.slice(index)], index);
    if (skipped) this.notice = `Skipped ${skipped} tile${skipped === 1 ? '' : 's'} already in ${this.tileDefinition.label}.`;
    this.scrollToRow('.tile-row', index);
  }

  addSelectedTileEntries(): void { this.addTileEntries(this.sortedSelection()); }

  duplicateTileEntry(): void {
    const source = this.currentTileEntry;
    if (!source) return;
    const index = this.tileEntry + 1;
    this.editTiles(entries => insertAt(entries, index, source), index);
    this.scrollToRow('.tile-row', index);
  }

  removeTileEntry(): void {
    if (!this.currentTileEntry) return;
    const count = this.tileEntries.length;
    this.editTiles(entries => removeAt(entries, this.tileEntry), Math.max(0, Math.min(this.tileEntry, count - 2)));
  }

  moveTileEntry(delta: number): void {
    const to = this.tileEntry + delta;
    if (!this.currentTileEntry || to < 0 || to >= this.tileEntries.length) return;
    this.editTiles(entries => move(entries, this.tileEntry, to), to);
    this.scrollToRow('.tile-row', to);
  }

  clearTileEntry(): void {
    if (!this.currentTileEntry) return;
    this.editTileEntry(this.tileEntry, () => ({ tiles: {} }));
  }

  slotTile(entry: BuildingTilesEntry, key: string): string { return entry.tiles[key] ?? ''; }
  slotOffset(entry: BuildingTilesEntry, key: string, axis: 0 | 1): number { return entry.offsets?.[key]?.[axis] ?? 0; }
  hasOffset(entry: BuildingTilesEntry, key: string): boolean { return !!entry.offsets?.[key]; }
  /** The selected slot, or the category's display slot if none was picked yet. */
  get currentTileSlot(): string { return this.tileDefinition.enums.includes(this.tileSlot) ? this.tileSlot : this.tileDefinition.display; }

  selectTileSlot(index: number, key: string): void {
    this.tileEntry = index;
    this.tileSlot = key;
  }

  /** Where an offset slot's tile is drawn inside its cell (BuildingEntryDelegate::tileToPixelCoords). */
  slotTransform(entry: BuildingTilesEntry, key: string): string | null {
    const offset = entry.offsets?.[key];
    if (!offset) return null;
    const [x, y] = offset, scale = this.scale;
    return `translate(${(x - y) * 64 * scale}px, ${(x + y) * 32 * scale}px)`;
  }

  setSlotOffset(index: number, key: string, axis: 0 | 1, value: unknown): void {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return;
    const clamped = Math.max(-100, Math.min(100, number));
    this.editTileEntry(index, entry => {
      const current = entry.offsets?.[key] ?? [0, 0];
      return setEntryOffset(entry, key, axis === 0 ? clamped : current[0], axis === 1 ? clamped : current[1]);
    });
  }

  clearSlot(index: number, key: string, event: MouseEvent): void {
    event.preventDefault();
    this.editTileEntry(index, entry => setEntryTile(entry, key, null));
  }

  private draggedTiles(event: DragEvent): string[] | null {
    if (furnitureTileDrag.tiles?.length) return furnitureTileDrag.tiles;
    try {
      const names: unknown = JSON.parse(event.dataTransfer?.getData(FURNITURE_TILE_MIME) || 'null');
      return Array.isArray(names) && names.every(name => typeof name === 'string') && names.length ? names : null;
    } catch { return null; }
  }

  tileDragOver(event: DragEvent, target: string): void {
    // The payload can't be read during dragover, so accept any drag that started in the tile browser.
    if (!furnitureTileDrag.tiles && !event.dataTransfer?.types.includes(FURNITURE_TILE_MIME)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dropTarget = target;
  }

  tileDragLeave(target: string): void { if (this.dropTarget === target) this.dropTarget = null; }

  /** Several tiles dropped on a slot fill it and the slots after it, like a run of tiles in a sheet. */
  dropOnSlot(event: DragEvent, index: number, key: string): void {
    event.preventDefault();
    this.dropTarget = null;
    const tiles = this.draggedTiles(event);
    if (!tiles) return;
    const enums = this.tileDefinition.enums, start = enums.indexOf(key);
    this.tileSlot = key;
    this.editTileEntry(index, entry => tiles.slice(0, enums.length - start)
      .reduce((next, tile, i) => setEntryTile(next, enums[start + i], tile), entry));
  }

  dropNewEntries(event: DragEvent): void {
    event.preventDefault();
    this.dropTarget = null;
    const tiles = this.draggedTiles(event);
    if (tiles) this.addTileEntries(tiles, this.tileEntries.length);
  }

  /** CSS sprite of a tile straight from its sheet; null while loading or if the sheet isn't downloaded. */
  sprite(name: string): Record<string, string> | null {
    if (!name) return null;
    if (this.spriteScale !== this.scale) { this.sprites.clear(); this.spriteScale = this.scale; }
    if (!this.sprites.has(name)) {
      this.sprites.set(name, null);
      const scale = this.scale;
      void this.db.getTileSprite(name).then(sprite => {
        if (!sprite || scale !== this.spriteScale) return;
        this.sprites.set(name, {
          'background-image': `url(${sprite.url})`,
          'background-size': `${sprite.columns * 128 * scale}px ${sprite.rows * 256 * scale}px`,
          'background-position': `${-sprite.column * 128 * scale}px ${-sprite.row * 256 * scale}px`,
        });
      }).catch(() => { /* Missing sheets show the tile name instead. */ });
    }
    return this.sprites.get(name) ?? null;
  }

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

  duplicateFurniture(): void {
    const source = this.current;
    if (!source) return;
    const index = this.furniture + 1;
    // Furniture is immutable, so the copy can share the original's entries.
    this.commit(updateGroup(this.groups, this.group, g => ({ ...g, furniture: insertAt(g.furniture, index, { ...source }) })),
      { furniture: index, orient: this.orient });
    this.scrollToRow('.furniture-row', index);
  }

  private scrollToRow(selector: string, index: number): void {
    // Wait for the new row to render.
    setTimeout(() => {
      const row = this.furnitureScroll?.nativeElement.querySelectorAll<HTMLElement>(selector)[index];
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
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

  shiftTiles(furniture: number, offset: number): void {
    const catalog = { names: this.tilesets, size: (sheet: string) => this.sheetSizes.get(sheet) };
    this.editCurrent(item => shiftTiles(item, offset, catalog), furniture, this.furniture === furniture ? this.orient : 'W');
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
      const tilesets = await this.db.getTilesets();
      this.sheetSizes = new Map(tilesets.map(tileset => [tileset.name, tileset.columns * tileset.rows]));
      this.sheetColumns = new Map(tilesets.map(tileset => [tileset.name, tileset.columns]));
      this.tilesets = tilesets.map(tileset => tileset.name).sort((a, b) => a.localeCompare(b));
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
    const names = this.sortedSelection();
    furnitureTileDrag.tiles = names;
    event.dataTransfer?.setData(FURNITURE_TILE_MIME, JSON.stringify(names));
    event.dataTransfer?.setData('text/plain', names.join('\n'));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  private sortedSelection(): string[] {
    return [...this.selectedTiles].sort((a, b) => (parseTileName(a)?.index ?? 0) - (parseTileName(b)?.index ?? 0));
  }

  @HostListener('document:dragend')
  endTileDrag(): void { furnitureTileDrag.tiles = null; this.dropTarget = null; }

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
