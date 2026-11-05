import { AddTile, Redo, SetSelectedFurniture, Undo } from '../app.actions';
import { VisualFurniture } from '../models/furniture-window.models';
import { FurnitureService } from '../services/furniture.service';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile } from '../utils/tbx-format';
import { emptyIndexGrid, writeIndexGrid } from '../utils/tbx-grid';
import ToolFurniture from './tool-furniture';

function setup(corners = true) {
    const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
    building.width = building.height = 4;
    building.entries = [{ category: 'interior_walls', tiles: [
        'West', 'North', 'NorthWest', 'SouthEast',
    ].map(orientation => ({ enum: orientation, tile: `wall_${orientation}` })) }];
    building.ExteriorWall = building.rooms[0].InteriorWall = 1;
    building.floors = [
        { objects: [], rooms: writeIndexGrid(emptyIndexGrid(4, 4).map(row => row.map(() => 1))), tileLayers: [] },
        { objects: [], rooms: writeIndexGrid(emptyIndexGrid(4, 4)), tileLayers: [] },
    ];
    const scene = documentHarness(building);
    const furniture: VisualFurniture = {
        corners,
        entries: (corners ? ['W', 'N', 'E', 'S', 'NW', 'NE', 'SW', 'SE'] : ['W', 'N', 'E', 'S']).map((orient, index) => ({
            orient, xSize: 0, ySize: 0,
            tiles: [{ name: `chair_00${index}.png`, url: '', x: 0, y: 0, level: 0, layer: 'Furniture' }],
        })),
    };
    scene.store.dispatch(new SetSelectedFurniture(furniture, 'E'));
    const tool = new ToolFurniture(scene.grid, scene.store as any, new FurnitureService(null!, scene.buildings, scene.store as any));
    const expectedTile = (orient: string) => furniture.entries.find(entry => entry.orient === orient)!.tiles[0].name;
    return { ...scene, furniture, tool, expectedTile };
}

describe('Furniture facing', () => {
    for (const [x, y, orient] of [
        [0, 1, 'W'], [1, 0, 'N'], [3, 1, 'E'], [1, 3, 'S'],
        [0, 0, 'NW'], [3, 0, 'NE'], [0, 3, 'SW'], [3, 3, 'SE'],
    ] as const) {
        it(`backs the preview against ${orient} walls and places the same facing on a click`, () => {
            const scene = setup();
            scene.tool.hoverTile(x, y, 'N');
            expect(scene.tool.tileGhosts.map(tile => tile.name)).toEqual([scene.expectedTile(orient)]);
            scene.tool.clickTile(x, y);
            expect(scene.buildings.building.floors[0].objects[0].orient).toBe(orient);
            expect(scene.state.value.past.length).toBe(1);
            scene.store.dispatch(new Undo());
            expect(scene.buildings.building.floors[0].objects).toEqual([]);
            scene.store.dispatch(new Redo());
            expect(scene.buildings.building.floors[0].objects[0].orient).toBe(orient);
            scene.destroy();
        });
    }

    it('uses the nearer wall edge when corner furniture is unavailable', () => {
        const scene = setup(false);
        for (const [x, y, edge, orient] of [
            [0, 0, 'W', 'W'], [0, 0, 'N', 'N'], [3, 0, 'E', 'E'], [3, 0, 'N', 'N'],
            [0, 3, 'W', 'W'], [0, 3, 'S', 'S'], [3, 3, 'E', 'E'], [3, 3, 'S', 'S'],
        ] as const) {
            scene.tool.hoverTile(x, y, edge);
            expect(scene.tool.tileGhosts[0].name).withContext(`${x},${y} ${edge}`).toBe(scene.expectedTile(orient));
        }
        scene.destroy();
    });

    it('keeps the selected orientation away from walls and ignores walls on another floor', () => {
        const scene = setup();
        scene.tool.hoverTile(1, 1);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('E'));
        scene.grid.setSelectedLevel(1);
        scene.tool.hoverTile(0, 0);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('E'));
        scene.destroy();
    });

    it('detects manually painted known wall tiles on Walls and Walls2', () => {
        const scene = setup();
        scene.store.dispatch(new AddTile(1, 1, 0, 'Walls', 'wall_North.png'));
        scene.tool.hoverTile(1, 1);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('N'));
        scene.store.dispatch(new AddTile(1, 1, 0, 'Walls2', 'wall_West.png'));
        scene.tool.hoverTile(1, 1);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('NW'));
        scene.destroy();
    });

    for (const [x, y, orient] of [
        [-4, -4, 'NW'], [4, -4, 'NE'], [-4, 4, 'SW'], [4, 4, 'SE'],
    ] as const) {
        it(`allows dragging to ${orient} outside the grid to override wall snapping`, () => {
            const scene = setup();
            scene.tool.hoverTile(0, 0);
            scene.tool.beginDrag(0, 0);
            scene.tool.hoverTile(x, y);
            expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile(orient));
            expect([scene.tool.tileGhosts[0].x, scene.tool.tileGhosts[0].y]).toEqual([0, 0]);
            scene.tool.endDrag(x, y);
            expect(scene.buildings.building.floors[0].objects[0].orient).toBe(orient);
            scene.destroy();
        });
    }

    it('uses fractional pointer angles for corner sectors and falls back when a corner entry is empty', () => {
        const scene = setup();
        scene.tool.beginDrag(1, 1);
        scene.tool.pointerPosition = { x: 2.9, y: .9 };
        scene.tool.hoverTile(2, 0);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('NE'));
        scene.tool.pointerPosition = { x: 2.9, y: 1.1 };
        scene.tool.hoverTile(2, 1);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('E'));
        const partial = { ...scene.furniture, entries: scene.furniture.entries.map(entry => entry.orient === 'NE' ? { ...entry, tiles: [] } : entry) };
        scene.store.dispatch(new SetSelectedFurniture(partial, 'W'));
        scene.tool.pointerPosition = { x: 2.5, y: .5 };
        scene.tool.hoverTile(2, 0);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('N'));
        scene.tool.endDrag(2, 0);
        expect(scene.buildings.building.floors[0].objects[0].orient).toBe('N');
        scene.destroy();
    });

    it('does not snap or show furniture previews while Ctrl-erasing', () => {
        const scene = setup();
        scene.tool.key = 'Control';
        scene.tool.hoverTile(0, 0);
        expect(scene.tool.tileGhosts).toEqual([]);
        scene.tool.clickTile(0, 0);
        expect(scene.buildings.building.floors[0].objects).toEqual([]);
        expect(scene.state.value.past.length).toBe(0);
        scene.destroy();
    });

    it('keeps a usable preview when the wall-facing entry does not exist', () => {
        const scene = setup(false);
        const partial = { ...scene.furniture, entries: scene.furniture.entries.filter(entry => entry.orient !== 'N') };
        scene.store.dispatch(new SetSelectedFurniture(partial, 'W'));
        scene.tool.hoverTile(1, 0);
        expect(scene.tool.tileGhosts[0].name).toBe(scene.expectedTile('W'));
        scene.tool.clickTile(1, 0);
        expect(scene.buildings.building.floors[0].objects[0].orient).toBe('W');
        scene.destroy();
    });
});
