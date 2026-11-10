import { AddTile, Redo, SetSelectedFurniture, Undo } from '../app.actions';
import { VisualFurniture } from '../models/furniture-window.models';
import { FurnitureService } from '../services/furniture.service';
import { documentHarness } from '../testing/document-harness';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile, writeBuildingFile } from '../utils/tbx-format';
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

function wallSetup(width = 1, height = 1, orient = 'W') {
    const scene = setup(false);
    const furniture: VisualFurniture = { layer: 'Walls', corners: false, entries: ['W', 'N', 'E', 'S'].map((orient, i) => ({
        orient, xSize: width - 1, ySize: height - 1,
        tiles: i > 1 ? [] : Array.from({ length: width * height }, (_, index) => ({
            name: `wall_replacement_01_00${i}.png`, url: '', x: index % width, y: Math.floor(index / width), layer: 'Walls', level: 0,
        })),
    })) };
    scene.store.dispatch(new SetSelectedFurniture(furniture, orient));
    return { ...scene, furniture };
}

describe('Furniture facing', () => {
    for (const facing of ['W', 'N', 'E', 'S']) {
        it(`keeps sidebar facing ${facing} through hover and drag when no wall is under the pointer`, () => {
            const scene = wallSetup(1, 1, facing);
            scene.tool.pointerPosition = { x: 1.6, y: 1.4 };
            const expectedPosition = ['W', 'E'].includes(facing) ? [2, 1] : [1, 1];
            for (const edge of ['W', 'N', 'E', 'S']) {
                scene.tool.hoverTile(1, 1, edge);
                expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y])).toEqual([expectedPosition]);
                expect(scene.tool.tileGhosts[0].name).toBe(`wall_replacement_01_00${['N', 'S'].includes(facing) ? 1 : 0}.png`);
            }
            scene.tool.beginDrag(1, 1);
            for (const point of [{ x: -3, y: -3 }, { x: 6, y: 6 }, { x: -3, y: 6 }]) {
                scene.tool.pointerPosition = point; scene.tool.hoverTile(point.x, point.y);
                expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y])).toEqual([expectedPosition]);
            }
            scene.tool.endDrag(-3, 6);
            const object = scene.buildings.building.floors[0].objects[0];
            expect(object.orient).toBe(facing);
            expect(scene.grid.roomTiles.filter(tile => tile.object === object.uid).map(tile => [tile.x, tile.y])).toEqual([expectedPosition]);
            scene.destroy();
        });
    }

    for (const [facing, edge] of [['W', 'E'], ['N', 'S']] as const) {
        it(`uses sidebar facing ${facing} on an empty interior line and follows the outer ${edge} wall`, () => {
            const scene = wallSetup(1, 1, facing);
            const x = facing === 'W' ? 3 : 1, y = facing === 'N' ? 3 : 1;
            scene.tool.hoverTile(x, y, facing);
            expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y])).toEqual([[x, y]]);
            scene.tool.hoverTile(x, y, edge);
            expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y])).toEqual([[x + (facing === 'W' ? 1 : 0), y + (facing === 'N' ? 1 : 0)]]);
            scene.tool.clickTile(x, y);
            const object = scene.buildings.building.floors[0].objects[0];
            expect(object.orient).toBe(edge);
            expect([object.x, object.y]).toEqual([x, y]);
            scene.destroy();
        });
    }

    for (const [selected, x, y, edge] of [
        ['W', 1, 0, 'N'], ['N', 0, 1, 'W'], ['N', 3, 1, 'E'], ['W', 1, 3, 'S'],
    ] as const) {
        it(`snaps sidebar facing ${selected} to an existing ${edge} wall and places the same preview`, () => {
            const scene = wallSetup(1, 1, selected);
            scene.tool.hoverTile(x, y, edge);
            const preview = scene.tool.tileGhosts.map(tile => [tile.x, tile.y, tile.name]);
            expect(preview).toEqual([[x + (edge === 'E' ? 1 : 0), y + (edge === 'S' ? 1 : 0),
                `wall_replacement_01_00${['N', 'S'].includes(edge) ? 1 : 0}.png`]]);
            expect(scene.state.value.selectedFurnitureOrient).toBe(selected);
            scene.tool.clickTile(x, y);
            const object = scene.buildings.building.floors[0].objects[0];
            expect(object.orient).toBe(edge);
            expect(scene.grid.roomTiles.filter(tile => tile.object === object.uid).map(tile => [tile.x, tile.y, tile.name])).toEqual(preview);
            scene.destroy();
        });
    }

    it('returns to the sidebar facing when leaving a wall and does not snap to a wall on another edge', () => {
        const scene = wallSetup();
        scene.tool.hoverTile(1, 0, 'N');
        expect(scene.tool.tileGhosts[0].name).toBe('wall_replacement_01_001.png');
        scene.tool.hoverTile(1, 0, 'S');
        expect(scene.tool.tileGhosts[0].name).toBe('wall_replacement_01_000.png');
        expect(scene.tool.previewObject?.orient).toBe('W');
        scene.tool.clickTile(1, 0);
        expect(scene.buildings.building.floors[0].objects[0].orient).toBe('W');
        expect(scene.state.value.selectedFurnitureOrient).toBe('W');
        scene.destroy();
    });

    it('snaps to manually placed walls on Walls2 and falls back when the hovered edge is empty', () => {
        const scene = wallSetup();
        scene.store.dispatch(new AddTile(1, 1, 0, 'Walls2', 'wall_North.png'));
        scene.tool.hoverTile(1, 1, 'N'); expect(scene.tool.previewObject?.orient).toBe('N');
        scene.tool.hoverTile(1, 1, 'W'); expect(scene.tool.previewObject?.orient).toBe('W');
        scene.tool.clickTile(1, 1);
        expect(scene.buildings.building.floors[0].objects[0].orient).toBe('W');
        scene.destroy();
    });

    it('reuses the wall projection while the pointer moves without changing its snapped position', () => {
        const scene = wallSetup();
        scene.tool.pointerPosition = { x: 1.1, y: 1.2 }; scene.tool.hoverTile(1, 1, 'W');
        const first = scene.tool.previewTiles;
        scene.tool.pointerPosition = { x: 1.4, y: 1.1 }; scene.tool.hoverTile(1, 1, 'N');
        expect(scene.tool.previewTiles).toBe(first);
        scene.tool.pointerPosition = { x: 1.6, y: 1.1 }; scene.tool.hoverTile(1, 1, 'N');
        expect(scene.tool.previewTiles).not.toBe(first);
        scene.destroy();
    });
    for (const [x, y, facing, tx, ty, artwork] of [
        [0, 1, 'W', 0, 1, 0], [1, 0, 'N', 1, 0, 1],
        [3, 1, 'E', 4, 1, 0], [1, 3, 'S', 1, 4, 1],
    ] as const) {
        it(`previews and places Walls furniture on the ${facing} grid edge using native resolved artwork`, () => {
            const scene = wallSetup(1, 1, facing);
            scene.tool.hoverTile(x, y, facing);
            expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y, tile.name, tile.layer])).toEqual([
                [tx, ty, `wall_replacement_01_00${artwork}.png`, 'Walls'],
            ]);
            scene.tool.clickTile(x, y);
            const building = scene.buildings.building, object = building.floors[0].objects[0];
            expect([object.x, object.y, object.orient]).toEqual([x, y, facing]);
            expect(scene.grid.roomTiles.filter(tile => tile.object === object.uid).map(tile => [tile.x, tile.y, tile.name]))
                .toEqual([[tx, ty, `wall_replacement_01_00${artwork}.png`]]);
            expect(readBuildingFile(writeBuildingFile(building)).floors[0].objects[0].orient).toBe(facing);
            expect(scene.state.value.past.length).toBe(1);
            scene.store.dispatch(new Undo()); expect(scene.buildings.building.floors[0].objects.length).toBe(0);
            scene.store.dispatch(new Redo()); expect(scene.buildings.building.floors[0].objects[0].orient).toBe(facing);
            scene.destroy();
        });
    }

    for (const [x, y, edge, facing, ax, ay] of [
        [3, 1, 'E', 'E', 2, 1], [1, 3, 'S', 'S', 1, 2],
        [3, 0, 'N', 'N', 2, 0], [0, 3, 'W', 'W', 0, 2],
    ] as const) {
        it(`keeps a multi-tile ${facing} placement on the hovered grid line at ${x},${y}`, () => {
            const scene = wallSetup(2, 2, facing);
            scene.tool.hoverTile(x, y, edge);
            const preview = scene.tool.tileGhosts.map(tile => `${tile.x},${tile.y}:${tile.name}`).sort();
            expect(scene.tool.tileGhosts[0].x).toBe(ax + (facing === 'E' ? 1 : 0));
            expect(scene.tool.tileGhosts[0].y).toBe(ay + (facing === 'S' ? 1 : 0));
            scene.tool.clickTile(x, y);
            const object = scene.buildings.building.floors[0].objects[0];
            expect([object.x, object.y, object.orient]).toEqual([ax, ay, facing]);
            expect(scene.grid.roomTiles.filter(tile => tile.object === object.uid).map(tile => `${tile.x},${tile.y}:${tile.name}`).sort()).toEqual(preview);
            scene.destroy();
        });
    }

    it('retains the selected wall orientation and adjusted anchor while dragging', () => {
        const scene = wallSetup(2, 2, 'E');
        scene.tool.hoverTile(3, 1, 'E'); scene.tool.beginDrag(3, 1); scene.tool.hoverTile(0, 1);
        expect(scene.tool.tileGhosts[0].x).toBe(3);
        scene.tool.endDrag(0, 1);
        expect(scene.buildings.building.floors[0].objects.map(object => [object.x, object.y, object.orient])).toEqual([[2, 1, 'E']]);
        scene.destroy();
    });

    it('previews wall replacement through the native projection without hiding the perpendicular corner wall', () => {
        const scene = wallSetup();
        const before = scene.buildings.building;
        scene.tool.hoverTile(0, 0, 'W');
        expect(scene.tool.tileGhosts[0].layer).toBe('Walls2');
        expect(scene.tool.previewTiles?.some(tile => tile.x === 0 && tile.y === 0 && tile.layer === 'Walls' && tile.name === 'wall_North.png')).toBeTrue();
        expect(scene.buildings.building).toBe(before); expect(scene.state.value.past.length).toBe(0);
        scene.tool.clickTile(0, 0);
        const object = scene.buildings.building.floors[0].objects[0];
        expect(scene.grid.roomTiles.some(tile => tile.object === object.uid && tile.x === 0 && tile.y === 0 && tile.layer === 'Walls2')).toBeTrue();
        scene.destroy();
    });

    it('resolves every cardinal wall facing from a W-only definition and prevents placement beyond the footprint', () => {
        const scene = wallSetup();
        const furniture = { ...scene.furniture, entries: scene.furniture.entries.filter(entry => entry.orient === 'W') };
        scene.store.dispatch(new SetSelectedFurniture(furniture, 'S'));
        scene.tool.hoverTile(1, 3, 'S'); expect(scene.tool.tileGhosts[0].name).toBe('wall_replacement_01_000.png');
        scene.tool.clickTile(1, 3); expect(scene.buildings.building.floors[0].objects[0].orient).toBe('S');
        const before = scene.buildings.building;
        scene.tool.hoverTile(4, 1); expect(scene.tool.tileGhosts).toEqual([]);
        scene.tool.clickTile(4, 1); expect(scene.buildings.building).toBe(before);
        const service = new FurnitureService(null!, scene.buildings, scene.store as any);
        service.placeFurniture(5, 1, 0, 'W', furniture);
        expect(scene.buildings.building).toBe(before);
        scene.destroy();
    });
    for (const [x, y, edge, tx, ty, backX, backY] of [
        [3, 1, 'W', 3, 1, 4, 1], [1, 3, 'N', 1, 3, 1, 4],
        [2, 1, 'E', 3, 1, 4, 1], [1, 2, 'S', 1, 3, 1, 4],
    ] as const) {
        it(`places on the ${edge} grid line one position forward of the back wall at ${backX},${backY}`, () => {
            const scene = wallSetup(1, 1, edge);
            const backWall = scene.grid.roomTiles.filter(tile => tile.x === backX && tile.y === backY && tile.layer === 'Walls');
            scene.tool.hoverTile(x, y, edge);
            expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y])).toEqual([[tx, ty]]);
            scene.tool.clickTile(x, y);
            const object = scene.buildings.building.floors[0].objects[0];
            expect(object.orient).toBe(edge);
            expect(scene.grid.roomTiles.filter(tile => tile.object === object.uid).map(tile => [tile.x, tile.y])).toEqual([[tx, ty]]);
            expect(scene.grid.roomTiles.filter(tile => tile.x === backX && tile.y === backY && tile.layer === 'Walls')).toEqual(backWall);
            scene.destroy();
        });
    }

    for (const [edge, tx, ty] of [['W', 1, 1], ['N', 1, 1], ['E', 2, 1], ['S', 1, 2]] as const) {
        it(`snaps to the ${edge} grid line when there are no walls`, () => {
            const scene = wallSetup(1, 1, edge); scene.grid.setSelectedLevel(1);
            expect(scene.grid.roomTiles.filter(tile => tile.level === 1)).toEqual([]);
            scene.tool.hoverTile(1, 1, edge);
            expect(scene.tool.tileGhosts.map(tile => [tile.x, tile.y])).toEqual([[tx, ty]]);
            scene.tool.clickTile(1, 1);
            const object = scene.buildings.building.floors[1].objects[0];
            expect(object.orient).toBe(edge);
            expect(scene.grid.roomTiles.filter(tile => tile.object === object.uid).map(tile => [tile.x, tile.y])).toEqual([[tx, ty]]);
            scene.destroy();
        });
    }

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
