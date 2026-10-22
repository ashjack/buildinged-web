import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Undo } from '../../app.actions';
import { BuildingService } from '../../services/building.service';
import { DbService } from '../../services/db.service';
import { GridService } from '../../services/grid.service';
import { RoomService } from '../../services/room.service';
import { RoomTileLibraryService } from '../../services/room-tile-library.service';
import { documentHarness } from '../../testing/document-harness';
import { nativeBuildingXml } from '../../testing/native-building.fixture';
import { roomEntryFromTile } from '../../utils/room-tile-entries';
import { readBuildingFile, writeBuildingFile } from '../../utils/tbx-format';
import { RoomsDialogComponent } from '../rooms-dialog/rooms-dialog.component';
import { RoomTilePickerComponent } from './room-tile-picker.component';

describe('Native room tile picker and library', () => {
    let h: ReturnType<typeof documentHarness>;
    const floor = roomEntryFromTile('floors', 'floor_000');
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKDcAAAAASUVORK5CYII=';
    beforeEach(() => {
        localStorage.clear();
        const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
        building.entries.push(floor); building.rooms[0].Floor = 2;
        h = documentHarness(building);
        spyOn(h.buildings, 'getDefaultTileEntries').and.resolveTo([floor, roomEntryFromTile('interior_walls', 'wall_000')]);
        TestBed.configureTestingModule({ declarations: [RoomsDialogComponent, RoomTilePickerComponent], imports: [CommonModule, FormsModule], providers: [
            { provide: Store, useValue: h.store }, { provide: BuildingService, useValue: h.buildings }, { provide: GridService, useValue: h.grid },
            { provide: RoomService, useValue: h.rooms }, { provide: DbService, useValue: {
                getTile: async () => ({ url: image }), getTilesets: async () => [{ name: 'custom_floor' }],
                getTiles: async () => [0, 1, 2].map(i => ({ name: `custom_floor_00${i}.png`, url: image, tileset: 'custom_floor' })),
            } },
        ] });
    });
    afterEach(() => h.destroy());
    function setup() {
        const fixture = TestBed.createComponent(RoomsDialogComponent); fixture.detectChanges();
        const rooms = fixture.componentInstance; rooms.open(); rooms.selectedMaterial = rooms.materials[2]; fixture.detectChanges();
        return { fixture, rooms, picker: rooms.tilePicker };
    }

    it('opens a category-specific thumbnail picker with the current entry, None, zoom and double-click selection', async () => {
        const { fixture, rooms, picker } = setup();
        rooms.chooseTile(); await fixture.whenStable(); fixture.detectChanges();
        expect(picker.picker.nativeElement.open).toBeTrue(); expect(picker.choices.length).toBe(2);
        expect(picker.choice!.category).toBe('floors'); expect(picker.thumbnail(picker.choice)).toBe(image);
        picker.scale = 1.5; fixture.detectChanges();
        const buttons = fixture.nativeElement.querySelectorAll('.choices button');
        expect(buttons[1].querySelector('img').style.width).toBe('96px');
        buttons[0].dispatchEvent(new MouseEvent('click')); buttons[0].dispatchEvent(new MouseEvent('dblclick')); fixture.detectChanges();
        expect(rooms.selectedDefinition).toBeNull(); expect(picker.picker.nativeElement.open).toBeFalse();
        rooms.apply(); expect(h.buildings.building.rooms[0].Floor).toBe(0);
        expect(h.grid.roomTiles.filter(t => t.layer === 'Floor').length).toBe(0);
    });

    it('leaves the room unchanged when the picker or the enclosing Rooms dialog is canceled', async () => {
        const { fixture, rooms, picker } = setup(), before = h.buildings.building;
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); picker.choice = null; picker.cancel();
        expect(rooms.selectedDefinition).toEqual(floor);
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); picker.choice = null; picker.choose(); rooms.cancel();
        expect(h.buildings.building).toBe(before); expect(h.state.value.past.length).toBe(0); fixture.detectChanges();
    });

    it('navigates the picker with arrows and accepts the focused tile with Enter', async () => {
        const { fixture, rooms, picker } = setup(); await picker.open('floors', 'Floor', rooms.room!.Name, floor); fixture.detectChanges();
        const buttons = fixture.nativeElement.querySelectorAll('.choices button');
        buttons[0].focus(); buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(document.activeElement).toBe(buttons[1]); expect(picker.choice!.category).toBe('floors');
        buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(picker.picker.nativeElement.open).toBeFalse(); expect(rooms.selectedDefinition).toEqual(floor);
    });

    it('sections choices by tileset and keeps navigation and filtering correct across partial rows', async () => {
        (h.buildings.getDefaultTileEntries as jasmine.Spy).and.resolveTo([
            roomEntryFromTile('floors', 'floor_004'), roomEntryFromTile('floors', 'custom_floor_007'), roomEntryFromTile('floors', 'custom_floor_003'),
        ]);
        const { fixture, rooms, picker } = setup();
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); picker.scale = 0.5; fixture.detectChanges();
        const sections: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.tileset-section'));
        expect(sections.map(section => section.querySelector('h3')!.textContent)).toEqual(['None', 'custom_floor', 'floor']);
        expect(Array.from(sections[1].querySelectorAll('button')).map(button => button.title)).toEqual(['custom_floor_003', 'custom_floor_007']);
        expect(sections[2].getBoundingClientRect().top).toBeGreaterThan(sections[1].getBoundingClientRect().bottom - 1);
        const custom = sections[1].querySelectorAll('button')[1];
        custom.focus(); custom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); fixture.detectChanges();
        expect(picker.display(picker.choice)).toBe('floor_004');
        expect(document.activeElement).toBe(sections[2].querySelectorAll('button')[1]);
        picker.search = 'custom_floor'; fixture.detectChanges();
        expect(Array.from(fixture.nativeElement.querySelectorAll('.tileset-heading')).map((heading: any) => heading.textContent)).toEqual(['None', 'custom_floor']);
        expect(fixture.nativeElement.querySelector('.tileset-section[aria-label="custom_floor"] button[title="custom_floor_007"]')).toBe(custom);
    });

    it('ignores an old library load after cancellation and reopening on a different category', async () => {
        const { rooms, picker } = setup(), wall = roomEntryFromTile('interior_walls', 'wall_000');
        let finish!: (entries: typeof floor[]) => void;
        spyOn(TestBed.inject(RoomTileLibraryService), 'load').and.returnValues(new Promise(resolve => finish = resolve), Promise.resolve([wall]));
        const old = picker.open('floors', 'Floor', rooms.room!.Name, floor); picker.cancel();
        await picker.open('interior_walls', 'Interior wall', rooms.room!.Name, wall);
        finish([floor]); await old;
        expect(picker.choices.filter(entry => entry).every(entry => entry!.category === 'interior_walls')).toBeTrue();
        expect(picker.choice).toEqual(wall); expect(picker.loading).toBeFalse();
    });

    it('adds reusable presets from sprites in Tiles, keeps them after canceling Rooms, and reloads them across library instances', async () => {
        const { fixture, rooms, picker } = setup(), before = h.buildings.building;
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); await picker.openManager(); fixture.detectChanges();
        const sprites = fixture.nativeElement.querySelectorAll('.sprites button');
        sprites[1].click(); fixture.detectChanges();
        (fixture.nativeElement.querySelector('[aria-label="Add selected tiles"]') as HTMLButtonElement).click();
        expect(picker.selectedEntry!.tiles[0].tile).toBe('custom_floor_001');
        await picker.closeManager(); picker.choose(); rooms.cancel();
        expect(h.buildings.building).toBe(before);
        const reloaded = new RoomTileLibraryService(h.buildings);
        expect((await reloaded.load()).some(e => e.tiles[0].tile === 'custom_floor_001')).toBeTrue();
    });

    it('imports a chosen preset into the document only on Rooms OK and undoes both the room assignment and definition', async () => {
        const { rooms, picker } = setup(), before = h.buildings.building;
        const custom = roomEntryFromTile('floors', 'custom_floor_002');
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); picker.choice = custom; picker.choose();
        expect(h.buildings.building).toBe(before); rooms.apply();
        expect(h.buildings.building.entries.length).toBe(before.entries.length + 1);
        expect(h.grid.roomTiles.some(t => t.name === 'custom_floor_002.png')).toBeTrue();
        expect(h.state.value.past.length).toBe(1); h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
    });

    it('supports library undo/redo and rejects invalid variant offsets without closing the manager', async () => {
        const { rooms, picker } = setup(); await picker.open('floors', 'Floor', rooms.room!.Name, floor); await picker.openManager();
        picker.selectedSprites.add(picker.sprites[0].name); picker.addSprites(); const count = picker.managed.length;
        picker.undoLibrary(); expect(picker.managed.length).toBe(count - 1);
        picker.undoLibrary(true); expect(picker.managed.length).toBe(count);
        picker.selectedEntry = picker.categoryEntries[picker.categoryEntries.length - 1]; picker.updateVariant(0, 'wrong', true);
        await picker.closeManager(); expect(picker.manager.nativeElement.open).toBeTrue(); expect(picker.managerError).toContain('integer offsets');
        picker.undoLibrary(); await picker.closeManager(); expect(picker.manager.nativeElement.open).toBeFalse();
    });

    it('switches to the native shadow-slot grid and persists blank expert entries and the mode preference', async () => {
        const { fixture, rooms, picker } = setup();
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); await picker.openManager(); fixture.detectChanges();
        (fixture.nativeElement.querySelector('[aria-label="Expert mode"]') as HTMLButtonElement).click(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.presets-grid')).toBeNull();
        expect(picker.expertShadow).toBe('assets/icons/shadow_floors.png');
        const add = fixture.nativeElement.querySelector('[aria-label="Add blank tile entry"]') as HTMLButtonElement;
        expect(add.disabled).toBeFalse(); add.click(); add.click(); fixture.detectChanges();
        expect(picker.categoryEntries.length).toBe(3);
        expect(picker.categoryEntries.slice(1).every(entry => entry.tiles.every(tile => tile.tile === 'None'))).toBeTrue();
        expect(fixture.nativeElement.querySelectorAll('.expert-entry').length).toBe(3);
        await picker.closeManager();
        const loaded = await TestBed.inject(RoomTileLibraryService).load();
        expect(loaded.filter(entry => entry.category === 'floors' && entry.tiles.every(tile => tile.tile === 'None')).length).toBe(2);
        expect(localStorage.getItem('roomTileLibraryExpertMode')).toBe('true');
        const reopened = new RoomTilePickerComponent(h.buildings, TestBed.inject(DbService), TestBed.inject(RoomTileLibraryService));
        expect(reopened.expertMode).toBeTrue();
    });

    it('drops one sprite into one variant and previews its native isometric offset without changing other slots', async () => {
        const { fixture, rooms, picker } = setup();
        await picker.open('floors', 'Floor', rooms.room!.Name, floor); await picker.openManager();
        picker.changeCategory('interior_walls'); picker.toggleExpert(); picker.addSprites(); fixture.detectChanges();
        const dataTransfer = new DataTransfer(); picker.startSpriteDrag(new DragEvent('dragstart', { dataTransfer }), picker.sprites[1]);
        const north = fixture.nativeElement.querySelector('[aria-label="Entry 2 North"]') as HTMLButtonElement;
        north.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })); fixture.detectChanges();
        expect(picker.activeVariant!.tile).toBe('custom_floor_001'); expect(picker.selectedEnum).toBe('North');
        expect(picker.selectedEntry!.tiles.filter(tile => tile.tile !== 'None').length).toBe(1);
        expect(picker.display(picker.selectedEntry)).toBe('None'); // The native display slot is West.
        picker.setExpertOffset('x', '2'); picker.setExpertOffset('y', '-1'); fixture.detectChanges();
        expect(picker.activeVariant!.offset).toBe('2 -1');
        expect(picker.expertSpriteTransform(picker.selectedEntry!, 'North')).toBe('translate(48px, 8px)');
        expect((north.querySelector('img') as HTMLImageElement).style.transform).toBe('translate(48px, 8px)');
        picker.setExpertOffset('x', '99'); expect(picker.offsetX).toBe(3);
        picker.clearExpertTiles(); expect(picker.activeVariant!.tile).toBe('None'); expect(picker.activeVariant!.offset).toBe('3 -1');
        picker.undoLibrary(); expect(picker.activeVariant!.tile).toBe('custom_floor_001');
        await picker.revealExpertSprite(picker.selectedEntry!, 'North');
        expect(picker.sheet).toBe('custom_floor'); expect([...picker.selectedSprites]).toEqual(['custom_floor_001.png']);
        picker.undoLibrary(true); expect(picker.activeVariant!.tile).toBe('None');
    });

    it('clears selected slots and removes selected entry rows in one undo step per action', async () => {
        const { rooms, picker } = setup(); await picker.open('floors', 'Floor', rooms.room!.Name, floor); await picker.openManager();
        picker.changeCategory('interior_walls'); picker.toggleExpert(); picker.addSprites();
        const first = picker.categoryEntries[0];
        picker.selectExpert(first, 'West'); picker.selectExpert(first, 'North', new MouseEvent('click', { ctrlKey: true }));
        const commands = picker.past.length; picker.clearExpertTiles();
        expect(picker.past.length).toBe(commands + 1);
        expect(picker.variant(picker.categoryEntries[0], 'West')!.tile).toBe('None');
        expect(picker.variant(picker.categoryEntries[0], 'North')!.tile).toBe('None');
        expect(picker.variant(picker.categoryEntries[0], 'WestWindow')!.tile).toBe('wall_008');
        picker.undoLibrary(); expect(picker.variant(picker.categoryEntries[0], 'West')!.tile).toBe('wall_000');
        picker.selectExpert(picker.categoryEntries[0], 'West');
        picker.selectExpert(picker.categoryEntries[1], 'North', new MouseEvent('click', { ctrlKey: true }));
        picker.removeEntry(); expect(picker.categoryEntries.length).toBe(0);
        picker.undoLibrary(); expect(picker.categoryEntries.length).toBe(2);
    });

    it('uses four shadow columns and sixteen independent slots for wall grime, with keyboard selection', async () => {
        const { fixture, rooms, picker } = setup(); await picker.open('floors', 'Floor', rooms.room!.Name, floor); await picker.openManager();
        picker.toggleExpert(); picker.changeCategory('grime_wall'); picker.addSprites(); fixture.detectChanges();
        expect(picker.expertColumns).toBe(4); expect(picker.expertShadow).toBe('assets/icons/shadow_grime_wall.png');
        const slots = fixture.nativeElement.querySelectorAll('.expert-entry button'); expect(slots.length).toBe(16);
        slots[0].focus(); slots[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(slots[4]); expect(picker.selectedEnum).toBe('WestWindow');
        picker.selectedSprites.add(picker.sprites[2].name); picker.assignSelectedSprite();
        slots[4].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        expect(picker.activeVariant!.tile).toBe('None');
        picker.undoLibrary(); expect(picker.activeVariant!.tile).toBe('custom_floor_002');
    });

    it('saves hand-built expert variants and offsets into a room as one undoable TBX edit', async () => {
        const { rooms, picker } = setup(), before = h.buildings.building;
        rooms.selectedMaterial = rooms.materials[0];
        await picker.open('interior_walls', 'Interior wall', rooms.room!.Name, null); await picker.openManager();
        picker.toggleExpert(); picker.addSprites(); picker.selectedSprites.add(picker.sprites[0].name); picker.assignSelectedSprite();
        picker.setExpertOffset('x', '-1'); picker.setExpertOffset('y', '2');
        picker.selectExpert(picker.selectedEntry!, 'North'); picker.selectedSprites = new Set([picker.sprites[1].name]); picker.assignSelectedSprite();
        const definition = picker.selectedEntry!;
        await picker.closeManager(); picker.choose();
        expect(h.buildings.building).toBe(before); rooms.apply();
        const after = h.buildings.building, entry = after.entries[after.rooms[0].InteriorWall - 1];
        expect(entry).toEqual(definition); expect(entry.tiles.find(tile => tile.enum === 'West')!.offset).toBe('-1 2');
        expect(readBuildingFile(writeBuildingFile(after)).entries[after.rooms[0].InteriorWall - 1]).toEqual(entry);
        expect(h.state.value.past.length).toBe(1); h.store.dispatch(new Undo()); expect(h.buildings.building).toBe(before);
    });
});
