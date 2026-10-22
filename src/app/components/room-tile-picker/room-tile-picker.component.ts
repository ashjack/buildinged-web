import { Component, ElementRef, EventEmitter, Output, ViewChild } from '@angular/core';
import { TileEntry } from '../../models/app.models';
import { BuildingService } from '../../services/building.service';
import { DbService, PngTile } from '../../services/db.service';
import { RoomTileLibraryService } from '../../services/room-tile-library.service';
import { ROOM_MATERIALS } from '../../utils/room-definitions';
import { cloneRoomEntry, roomEntryDisplay, roomEntryFromTile, roomEntryKey, ROOM_TILE_ENUMS } from '../../utils/room-tile-entries';

@Component({ selector: 'app-room-tile-picker', templateUrl: './room-tile-picker.component.html', styleUrls: ['./room-tile-picker.component.scss'] })
export class RoomTilePickerComponent {
    @ViewChild('picker') picker: ElementRef<HTMLDialogElement>;
    @ViewChild('manager') manager: ElementRef<HTMLDialogElement>;
    @Output() tileChosen = new EventEmitter<TileEntry | null>();
    readonly categories = ROOM_MATERIALS;
    readonly display = roomEntryDisplay;
    readonly key = roomEntryKey;
    readonly Math = Math;
    defaults: TileEntry[] = [];
    choices: (TileEntry | null)[] = [];
    choice: TileEntry | null = null;
    category = 'floors';
    prompt = '';
    scale = Math.max(0.5, Math.min(2, Number(localStorage.getItem('roomTilePickerScale')) || 1));
    loading = false;
    error = '';
    search = '';
    managed: TileEntry[] = [];
    managedCategory = 'floors';
    selectedEntry: TileEntry | undefined;
    sheets: string[] = [];
    sheetFilter = '';
    sheet = '';
    sprites: PngTile[] = [];
    selectedSprites = new Set<string>();
    private anchor = -1;
    managerError = '';
    sheetLoading = false;
    saving = false;
    past: TileEntry[][] = [];
    future: TileEntry[][] = [];
    expertMode = localStorage.getItem('roomTileLibraryExpertMode') === 'true';
    libraryScale = Math.max(0.5, Math.min(2, Number(localStorage.getItem('roomTileLibraryScale')) || 0.5));
    selectedEnum = '';
    expertSelection = new Set<number>();
    private expertAnchor = -1;
    get expertEnums(): string[] { return ROOM_TILE_ENUMS[this.managedCategory] || []; }
    get expertColumns(): number { return this.managedCategory === 'grime_wall' ? 4 : this.expertEnums.length; }
    get expertShadow(): string {
        const name = ({ interior_walls: 'walls', interior_wall_trim: 'walls', floors: 'floors', grime_floor: 'grime_floor', grime_wall: 'grime_wall' } as Record<string, string>)[this.managedCategory];
        return `assets/icons/shadow_${name}.png`;
    }
    trackExpertRow(index: number): number { return index; }
    variant(entry: TileEntry, name: string) { return entry.tiles.find(tile => tile.enum === name); }
    get activeVariant() { return this.selectedEntry ? this.variant(this.selectedEntry, this.selectedEnum) : undefined; }
    get offsetX(): number { return Number((this.activeVariant?.offset || '0 0').split(/\s+/)[0]); }
    get offsetY(): number { return Number((this.activeVariant?.offset || '0 0').split(/\s+/)[1]); }
    expertSpriteTransform(entry: TileEntry, name: string): string {
        const [x, y] = (this.variant(entry, name)?.offset || '0 0').trim().split(/\s+/).map(Number);
        return `translate(${(x - y) * 32 * this.libraryScale}px, ${(x + y) * 16 * this.libraryScale}px)`;
    }
    toggleExpert(): void {
        this.expertMode = !this.expertMode;
        localStorage.setItem('roomTileLibraryExpertMode', String(this.expertMode));
        this.resetExpertSelection();
    }
    private resetExpertSelection(): void {
        if (!this.expertEnums.includes(this.selectedEnum)) this.selectedEnum = this.expertEnums[0] || '';
        const index = this.categoryEntries.indexOf(this.selectedEntry!);
        const cell = index * this.expertEnums.length + this.expertEnums.indexOf(this.selectedEnum);
        this.expertSelection = new Set(index >= 0 ? [cell] : []); this.expertAnchor = cell;
    }
    selectExpert(entry: TileEntry, name: string, event?: MouseEvent): void {
        const row = this.categoryEntries.indexOf(entry), column = this.expertEnums.indexOf(name);
        if (row < 0 || column < 0) return;
        const cell = row * this.expertEnums.length + column;
        if (!event?.ctrlKey && !event?.metaKey && !event?.shiftKey) this.expertSelection.clear();
        if (event?.shiftKey && this.expertAnchor >= 0) {
            for (let i = Math.min(cell, this.expertAnchor); i <= Math.max(cell, this.expertAnchor); i++) this.expertSelection.add(i);
        } else if ((event?.ctrlKey || event?.metaKey) && this.expertSelection.has(cell)) this.expertSelection.delete(cell);
        else this.expertSelection.add(cell);
        this.selectedEntry = entry; this.selectedEnum = name; this.expertAnchor = cell;
    }
    expertSelected(row: number, column: number): boolean { return this.expertSelection.has(row * this.expertEnums.length + column); }
    private changeExpertTiles(name: string, onlyActive = false): void {
        const entries = this.categoryEntries;
        const selectedIndex = entries.indexOf(this.selectedEntry!);
        const active = selectedIndex * this.expertEnums.length + this.expertEnums.indexOf(this.selectedEnum);
        const cells = onlyActive ? new Set([active]) : this.expertSelection;
        let changed = false;
        const next = this.managed.map(entry => {
            const row = entries.indexOf(entry); if (row < 0) return entry;
            let copy: TileEntry | undefined;
            this.expertEnums.forEach((value, column) => {
                if (!cells.has(row * this.expertEnums.length + column)) return;
                const old = this.variant(entry, value);
                if ((old?.tile || 'None') === name) return;
                copy ||= cloneRoomEntry(entry);
                const tile = this.variant(copy, value);
                if (tile) tile.tile = name; else copy.tiles.push({ enum: value, tile: name });
                changed = true;
            });
            return copy || entry;
        });
        if (changed) this.edit(next, next[this.managed.indexOf(this.selectedEntry!)]);
    }
    clearExpertTiles(): void { if (this.expertMode) this.changeExpertTiles('None'); }
    assignSelectedSprite(): void {
        const sprite = this.sprites.find(item => this.selectedSprites.has(item.name));
        if (this.expertMode && this.selectedEntry && sprite) this.changeExpertTiles(sprite.name.replace(/\.png$/i, ''), true);
    }
    setExpertOffset(axis: 'x' | 'y', value: string): void {
        const amount = Number(value);
        if (!this.expertMode || !this.selectedEntry || this.expertSelection.size !== 1 || !Number.isInteger(amount)) return;
        const x = axis === 'x' ? Math.max(-3, Math.min(3, amount)) : this.offsetX;
        const y = axis === 'y' ? Math.max(-3, Math.min(3, amount)) : this.offsetY;
        if (x === this.offsetX && y === this.offsetY) return;
        const entry = cloneRoomEntry(this.selectedEntry);
        let tile = this.variant(entry, this.selectedEnum);
        if (!tile) { tile = { enum: this.selectedEnum, tile: 'None' }; entry.tiles.push(tile); }
        tile.offset = `${x} ${y}`;
        this.edit(this.managed.map(item => item === this.selectedEntry ? entry : item), entry);
    }
    startSpriteDrag(event: DragEvent, sprite: PngTile): void {
        event.dataTransfer?.setData('application/x-buildinged-tile', sprite.name);
        event.dataTransfer?.setData('text/plain', sprite.name);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    }
    dropExpert(event: DragEvent, entry: TileEntry, name: string): void {
        event.preventDefault(); event.stopPropagation();
        const sprite = event.dataTransfer?.getData('application/x-buildinged-tile');
        if (!sprite || !/_\d+(\.png)?$/i.test(sprite)) return;
        this.selectExpert(entry, name); this.changeExpertTiles(sprite.replace(/\.png$/i, ''), true);
    }
    async revealExpertSprite(entry: TileEntry, name: string): Promise<void> {
        const tile = this.variant(entry, name)?.tile;
        if (!tile || tile === 'None') return;
        const sheet = tile.replace(/_\d+$/, '');
        if (!this.sheets.includes(sheet)) return;
        await this.selectSheet(sheet);
        const sprite = this.sprites.find(item => item.name.replace(/\.png$/i, '') === tile);
        if (!sprite) return;
        this.selectedSprites = new Set([sprite.name]);
        setTimeout(() => Array.from(this.manager.nativeElement.querySelectorAll<HTMLButtonElement>('.sprites button'))
            .find(button => button.title === sprite.name)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }
    expertKey(event: KeyboardEvent): void {
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.clearExpertTiles(); return; }
        if (event.key === 'Enter' && this.selectedEntry) {
            event.preventDefault(); void this.revealExpertSprite(this.selectedEntry, this.selectedEnum); return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=option]'));
        const current = buttons.indexOf((event.target as HTMLElement).closest('button')!); if (current < 0) return;
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -this.expertColumns : this.expertColumns;
        const next = Math.max(0, Math.min(buttons.length - 1, event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : current + delta));
        buttons[next].focus();
        this.selectExpert(this.categoryEntries[Math.floor(next / this.expertEnums.length)], this.expertEnums[next % this.expertEnums.length], event as unknown as MouseEvent);
    }
    private images = new Map<string, string>();
    private sheetRequest = 0;
    private pickerRequest = 0;
    constructor(private buildings: BuildingService, private db: DbService, private library: RoomTileLibraryService) { }

    async open(category: string, label: string, roomName: string, initial: TileEntry | null): Promise<void> {
        const request = ++this.pickerRequest;
        this.images.clear();
        this.category = category; this.prompt = `Choose ${label.toLowerCase()} tile for '${roomName}'`;
        this.choice = initial; this.error = ''; this.search = ''; this.choices = []; this.loading = true;
        this.picker.nativeElement.showModal();
        try {
            const entries = await this.library.load();
            if (request !== this.pickerRequest) return;
            this.defaults = entries;
            const known = new Set(entries.map(roomEntryKey));
            for (const entry of this.buildings.building.entries.filter(e => ROOM_TILE_ENUMS[e.category])) {
                if (!known.has(roomEntryKey(entry))) { known.add(roomEntryKey(entry)); this.defaults.push(entry); }
            }
            this.refreshChoices(initial);
        } catch { if (request === this.pickerRequest) this.error = 'Could not load the tile library. Close and reopen the picker to retry.'; }
        finally { if (request === this.pickerRequest) this.loading = false; }
    }
    private refreshChoices(initial: TileEntry | null): void {
        const entries = this.defaults.filter(entry => entry.category === this.category);
        if (initial && !entries.some(entry => roomEntryKey(entry) === roomEntryKey(initial))) entries.push(initial);
        this.choices = [null, ...entries.sort((a, b) => roomEntryDisplay(a).localeCompare(roomEntryDisplay(b)))];
        this.choice = initial ? (entries.includes(initial) ? initial : entries.find(entry => roomEntryKey(entry) === roomEntryKey(initial)) || null) : null;
    }
    get filteredChoices() { return this.choices.filter(entry => !entry || roomEntryDisplay(entry).toLowerCase().includes(this.search.toLowerCase())); }
    /** BuildingTileEntryView supplies the display sprite's tileset as each section header. */
    get choiceGroups(): { name: string; entries: (TileEntry | null)[] }[] {
        const groups = new Map<string, (TileEntry | null)[]>();
        for (const entry of this.filteredChoices) {
            const name = entry ? roomEntryDisplay(entry).replace(/\.png$/i, '').replace(/_\d+$/, '') : 'None';
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name)!.push(entry);
        }
        return [...groups].map(([name, entries]) => ({ name, entries }));
    }
    trackChoiceGroup(_index: number, group: { name: string }): string { return group.name; }
    isChosen(entry: TileEntry | null): boolean { return entry === this.choice; }
    thumbnail(entry: TileEntry | null | undefined): string { return this.image(roomEntryDisplay(entry)); }
    image(tile: string): string {
        if (!tile || tile === 'None') return 'assets/icons/none-tile.png';
        const name = tile.replace(/\.png$/i, '') + '.png';
        if (!this.images.has(name)) {
            this.images.set(name, 'assets/icons/missing-tile.png');
            this.db.getTile(name).then(result => { if (result) this.images.set(name, result.url); }).catch(() => {});
        }
        return this.images.get(name)!;
    }
    choose(): void {
        if (this.loading || this.error) return;
        localStorage.setItem('roomTilePickerScale', String(this.scale));
        this.tileChosen.emit(this.choice ? cloneRoomEntry(this.choice) : null); this.picker.nativeElement.close();
    }
    cancel(): void { ++this.pickerRequest; this.loading = false; localStorage.setItem('roomTilePickerScale', String(this.scale)); this.picker.nativeElement.close(); }
    gridKey(event: KeyboardEvent, kind: 'choice' | 'preset' | 'sprite'): void {
        const root = event.currentTarget as HTMLElement;
        const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[role=option]'));
        const index = buttons.indexOf((event.target as HTMLElement).closest('button')!);
        if (index < 0) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            if (kind === 'choice') { this.choice = this.filteredChoices[index]; this.choose(); }
            else if (kind === 'sprite') { this.selectedSprites = new Set([this.sprites[index].name]); this.expertMode ? this.assignSelectedSprite() : this.addSprites(); }
            return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const columns = getComputedStyle(root).gridTemplateColumns.split(' ').length;
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
        let next = Math.max(0, Math.min(buttons.length - 1, event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + delta));
        if (kind === 'choice' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            // Section headers and partly filled rows break the flat grid's column arithmetic.
            const origin = buttons[index].getBoundingClientRect(), down = event.key === 'ArrowDown';
            const rows = buttons.map((button, i) => ({ i, rect: button.getBoundingClientRect() }))
                .filter(item => down ? item.rect.top > origin.top + 1 : item.rect.top < origin.top - 1)
                .sort((a, b) => Math.abs(a.rect.top - origin.top) - Math.abs(b.rect.top - origin.top)
                    || Math.abs(a.rect.left - origin.left) - Math.abs(b.rect.left - origin.left));
            next = rows[0]?.i ?? index;
        }
        buttons[next].focus();
        if (kind === 'choice') this.choice = this.filteredChoices[next];
        if (kind === 'preset') this.selectedEntry = this.categoryEntries[next];
        if (kind === 'sprite') this.selectSprite(this.sprites[next], next, event as unknown as MouseEvent);
    }
    async openManager(): Promise<void> {
        this.images.clear();
        this.managed = this.defaults.map(cloneRoomEntry); this.managedCategory = this.category;
        this.selectedEntry = this.choice ? this.managed.find(entry => roomEntryKey(entry) === roomEntryKey(this.choice!)) : undefined;
        this.past = []; this.future = []; this.managerError = ''; this.selectedSprites.clear();
        this.selectedEnum = this.expertEnums[0]; this.resetExpertSelection();
        this.manager.nativeElement.showModal();
        try {
            this.sheets = (await this.db.getTilesets()).map(sheet => sheet.name).sort();
            const initialSheet = roomEntryDisplay(this.choice).replace(/_\d+$/, '');
            await this.selectSheet(this.sheets.includes(initialSheet) ? initialSheet : this.sheets[0] || '');
        } catch { this.managerError = 'Could not load tilesets. Check the Tilesets download window and try again.'; }
    }
    get filteredSheets() { return this.sheets.filter(sheet => sheet.toLowerCase().includes(this.sheetFilter.toLowerCase())); }
    get categoryEntries() { return this.managed.filter(entry => entry.category === this.managedCategory); }
    changeCategory(category: string): void { this.managedCategory = category; this.selectedEntry = this.categoryEntries[0]; this.selectedEnum = this.expertEnums[0]; this.resetExpertSelection(); }
    async selectSheet(sheet: string): Promise<void> {
        const request = ++this.sheetRequest;
        this.sheet = sheet; this.selectedSprites.clear(); this.anchor = -1; this.sheetLoading = true;
        this.sprites = [];
        try {
            const sprites = sheet ? await this.db.getTiles(sheet) : [];
            if (request === this.sheetRequest) {
                this.sprites = sprites.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                this.sprites.forEach(sprite => this.images.set(sprite.name, sprite.url));
            }
        } catch { if (request === this.sheetRequest) this.managerError = 'Could not load this tileset. Select it again to retry.'; }
        finally { if (request === this.sheetRequest) this.sheetLoading = false; }
    }
    selectSprite(sprite: PngTile, index: number, event: MouseEvent): void {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) this.selectedSprites.clear();
        if (event.shiftKey && this.anchor >= 0) {
            for (let i = Math.min(this.anchor, index); i <= Math.max(this.anchor, index); i++) this.selectedSprites.add(this.sprites[i].name);
        } else if ((event.ctrlKey || event.metaKey) && this.selectedSprites.has(sprite.name)) this.selectedSprites.delete(sprite.name);
        else this.selectedSprites.add(sprite.name);
        this.anchor = index;
    }
    private edit(next: TileEntry[], selection?: TileEntry): void {
        this.past = [...this.past, this.managed.map(cloneRoomEntry)].slice(-100); this.future = [];
        this.managed = next; this.selectedEntry = selection; this.managerError = '';
    }
    addSprites(): void {
        if (this.expertMode) {
            const entry: TileEntry = { category: this.managedCategory, tiles: this.expertEnums.map(value => ({ enum: value, tile: 'None' })) };
            const next = [...this.managed], index = this.selectedEntry ? next.indexOf(this.selectedEntry) + 1 : next.length;
            next.splice(index, 0, entry); this.edit(next, entry); this.selectedEnum = this.expertEnums[0]; this.resetExpertSelection(); return;
        }
        try {
            const keys = new Set(this.managed.map(roomEntryKey));
            const added: TileEntry[] = [];
            for (const sprite of this.sprites.filter(sprite => this.selectedSprites.has(sprite.name))) {
                const entry = roomEntryFromTile(this.managedCategory, sprite.name);
                if (!keys.has(roomEntryKey(entry))) { keys.add(roomEntryKey(entry)); added.push(entry); }
            }
            if (added.length) this.edit([...this.managed, ...added], added[added.length - 1]);
        } catch (error) { this.managerError = (error as Error).message; }
    }
    removeEntry(): void {
        if (!this.selectedEntry) return;
        const remove = this.expertMode && this.expertSelection.size
            ? new Set([...this.expertSelection].map(cell => this.categoryEntries[Math.floor(cell / this.expertEnums.length)]))
            : new Set([this.selectedEntry]);
        const next = this.managed.filter(entry => !remove.has(entry));
        this.edit(next, next.find(entry => entry.category === this.managedCategory));
        this.resetExpertSelection();
    }
    moveEntry(offset: number): void {
        const entries = this.categoryEntries, index = entries.indexOf(this.selectedEntry!);
        if (index < 0 || index + offset < 0 || index + offset >= entries.length) return;
        const next = [...this.managed], from = next.indexOf(entries[index]), to = next.indexOf(entries[index + offset]);
        [next[from], next[to]] = [next[to], next[from]]; this.edit(next, this.selectedEntry); this.resetExpertSelection();
    }
    updateVariant(index: number, value: string, offset = false): void {
        if (!this.selectedEntry) return;
        const entry = cloneRoomEntry(this.selectedEntry);
        if (offset) entry.tiles[index].offset = value.trim() || '0 0';
        else entry.tiles[index].tile = value.trim().replace(/\.png$/i, '') || 'None';
        this.edit(this.managed.map(item => item === this.selectedEntry ? entry : item), entry);
    }
    undoLibrary(redo = false): void {
        const source = redo ? this.future : this.past, snapshot = source[source.length - 1]; if (!snapshot) return;
        const current = this.managed.map(cloneRoomEntry);
        if (redo) { this.future = this.future.slice(0, -1); this.past = [...this.past, current]; }
        else { this.past = this.past.slice(0, -1); this.future = [...this.future, current]; }
        const selection = this.categoryEntries.indexOf(this.selectedEntry!);
        this.managed = snapshot; this.selectedEntry = this.categoryEntries[Math.max(0, Math.min(selection, this.categoryEntries.length - 1))]; this.managerError = ''; this.resetExpertSelection();
    }
    async closeManager(): Promise<void> {
        if (this.saving) return;
        this.saving = true; this.managerError = '';
        try {
            await this.library.save(this.managed);
            localStorage.setItem('roomTileLibraryScale', String(this.libraryScale));
            const selectedIndex = this.managed.indexOf(this.selectedEntry!);
            this.defaults = this.managed.map(cloneRoomEntry);
            const selected = this.selectedEntry?.category === this.category ? this.defaults[selectedIndex] : this.choice;
            this.refreshChoices(selected || null); this.manager.nativeElement.close();
        } catch (error) { this.managerError = (error as Error).message || 'Could not save the tile library.'; }
        finally { this.saving = false; }
    }
}
