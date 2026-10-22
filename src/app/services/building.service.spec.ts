import { BehaviorSubject, of } from 'rxjs';
import { BuildingService } from './building.service';
import { FurnitureService } from './furniture.service';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { documentHarness } from '../testing/document-harness';
import ToolDrawRoom from '../tools/tool-draw-room';
import { Redo, Undo } from '../app.actions';

describe('Building file integration', () => {
    const building = () => readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));

    it('keeps the open building when an import fails validation', async () => {
        const grid = { objects: ['existing'] };
        const rooms = { rooms: ['existing'] };
        const source = building();
        const store = { dispatch: jasmine.createSpy('dispatch'), select: () => of(source) };
        const service = new BuildingService(null!, null!, grid as any, rooms as any, store as any, null!);
        const before = service.building;
        await expectAsync(service.createBuildingFromXml(new DOMParser().parseFromString('<not-building/>', 'text/xml'))).toBeRejected();
        expect(service.building).toBe(before);
        expect(grid.objects).toEqual(['existing']);
        expect(rooms.rooms).toEqual(['existing']);
        expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('uses the furniture table directly even when used_furniture is reordered', () => {
        const source = building();
        source.furniture[1].layer = 'Furniture';
        const scene = documentHarness(source);
        expect(scene.grid.roomTiles.some(tile => tile.name === 'furniture_seating_indoor_01_001.png')).toBeTrue();
        scene.destroy();
    });

    it('renders new furniture with exactly the index committed to the store', () => {
        const scene = documentHarness(building());
        const service = new FurnitureService(null!, scene.buildings, scene.store as any);
        const definition = { entries: [{ orient: 'W', xSize: 0, ySize: 0, tiles: [{ name: 'furniture_seating_indoor_01_005.png', url: '', x: 0, y: 0, layer: 'Furniture', level: 0 }] }] };
        service.placeFurniture(1, 1, 0, 'W', definition);
        const object = scene.buildings.building.floors[0].objects[2];
        expect(object.FurnitureTiles).toBe(2);
        expect(scene.grid.objects.some(value => value.uid === object.uid)).toBeTrue();
        expect(scene.grid.roomTiles.some(tile => tile.object === object.uid && tile.name === 'furniture_seating_indoor_01_005.png')).toBeTrue();
        service.placeFurniture(0, 1, 0, 'W', definition);
        expect(scene.buildings.building.furniture.length).toBe(3);
        scene.destroy();
    });

    it('creates version 3 buildings with template offsets and furniture flags', async () => {
        const template = `TileEntry
{
    category = roof_slopes
    SlopePt5E = roofs_01_000
    offset = SlopePt5E 1 -2
}
furniture
{
    layer = Walls
    corners = true
    entry
    {
        orient = NW
        grime = false
        0,0 = furniture_seating_indoor_01_000
    }
}
Template
{
    Name = Test
    RoofSlope = 1
    UsedFurniture = 1
}`;
        const scene = documentHarness(undefined, template);
        const service = scene.buildings;
        await service.createNewBuilding('Test');
        expect(service.building.version).toBe(3);
        expect(service.building.entries[0].tiles[0].offset).toBe('1 -2');
        expect(service.building.furniture[0].corners).toBeTrue();
        expect(service.building.furniture[0].entries[0].grime).toBeFalse();
        expect(service.building.used_furniture).toBe('0');
        const xml = writeBuildingFile(service.building);
        expect(xml.getElementsByTagName('rooms')[0].textContent!.trim().split(',').length).toBe(400);
        scene.destroy();
    });

    it('exports every bundled template with valid palette references and offsets', async () => {
        const response = await fetch('/assets/BuildingTemplates.txt');
        expect(response.ok).toBeTrue();
        const text = await response.text();
        const scene = documentHarness(undefined, text);
        const service = scene.buildings;
        const names = await service.getTemplateNames();
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            await service.createNewBuilding(name);
            expect(() => writeBuildingFile(service.building)).withContext(name).not.toThrow();
        }
        expect(service.building.entries.some(entry => entry.tiles.some(tile => tile.offset))).toBeTrue();
        scene.destroy();
    });

    it('draws room floors from bundled templates and restores them through undo, redo and TBX reopening', async () => {
        const response = await fetch('/assets/BuildingTemplates.txt');
        expect(response.ok).toBeTrue();
        const scene = documentHarness(undefined, await response.text());
        try {
            const names = await scene.buildings.getTemplateNames();
            expect(names.length).toBeGreaterThan(0);
            for (const name of names) {
                await scene.buildings.createNewBuilding(name);
                const building = scene.buildings.building;
                const selected = building.rooms.find(room => room.Floor > 0 && !/^emptyoutside(?:#|$)/i.test(room.Name));
                expect(selected).withContext(name).toBeDefined();
                if (!selected) continue;
                scene.rooms.selectedRoom = selected;
                const expected = building.entries[selected.Floor - 1].tiles.find(tile => tile.enum === 'Floor')!.tile + '.png';
                const tool = new ToolDrawRoom(scene.rooms, scene.grid, scene.buildings, scene.store as any);
                tool.beginDrag(1, 1); tool.endDrag(2, 2);
                const floorNames = () => scene.grid.roomTiles.filter(tile => tile.layer === 'Floor' && tile.level === 0).map(tile => tile.name);
                expect(floorNames()).withContext(name).toEqual(Array(4).fill(expected));
                scene.store.dispatch(new Undo());
                expect(floorNames()).withContext(name).toEqual([]);
                scene.store.dispatch(new Redo());
                expect(floorNames()).withContext(name).toEqual(Array(4).fill(expected));
                const reopened = readBuildingFile(writeBuildingFile(scene.buildings.building));
                scene.buildings.renderBuilding(reopened);
                expect(floorNames()).withContext(name).toEqual(Array(4).fill(expected));
            }
        } finally {
            scene.destroy();
        }
    });

    it('takes one snapshot per save and releases its download URL', async () => {
        const subject = new BehaviorSubject(building());
        const store = { select: () => subject.asObservable() };
        const service = new BuildingService(null!, null!, null!, null!, store as any, null!);
        const click = spyOn(HTMLAnchorElement.prototype, 'click');
        spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
        const revoke = spyOn(URL, 'revokeObjectURL');
        spyOn(Storage.prototype, 'setItem');
        await service.saveBuildingToXml();
        subject.next(building());
        expect(click).toHaveBeenCalledTimes(1);
        expect(subject.observers.length).toBe(0);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(revoke).toHaveBeenCalledWith('blob:test');
    });
});
