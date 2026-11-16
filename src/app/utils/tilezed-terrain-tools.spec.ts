import { TilezedEditDocument } from './tilezed-edit';
import { readTilezedMap } from './tilezed-map';
import { generateTilezedScene } from './tilezed-terrain';
import { TilezedTerrainTools } from './tilezed-terrain-tools';
import { readTerrainSettings, terrainSettings, writeTerrainSettings } from './tilezed-terrain-settings';

const xml = `<map orientation="levelisometric" width="8" height="8" tilewidth="64" tileheight="32" custom="keep">
  <tileset firstgid="1" name="ground_01" tilewidth="64" tileheight="128"><image source="ground_01.png" width="512" height="128"/></tileset>
  ${['0_Floor', '0_FloorOverlay', '0_Vegetation'].map(name => `<layer name="${name}" width="8" height="8"><data encoding="csv">${Array(64).fill(0).join(',')}</data></layer>`).join('')}
  <bmp-settings><aliases><alias name="grass" tiles="ground_01_001"/></aliases><rules>
    <rule bitmapIndex="0" color="10 0 0" targetLayer="0_Floor" tileChoices="grass"/>
    <rule bitmapIndex="0" color="20 0 0" targetLayer="0_Floor" tileChoices="ground_01_000"/>
    <rule bitmapIndex="1" color="0 255 0" targetLayer="0_Vegetation" tileChoices="ground_01_002"/>
  </rules><blends><blend targetLayer="0_FloorOverlay" mainTile="grass" blendTile="ground_01_003" dir="n"/></blends></bmp-settings>
  <extension keep="yes"/>
</map>`;
async function open(): Promise<TilezedTerrainTools> { return new TilezedTerrainTools(new TilezedEditDocument(xml, generateTilezedScene(await readTilezedMap(xml)))); }
function paint(tools: TilezedTerrainTools, x: number, y: number, color = 0x0a0000): void {
  tools.color = color; tools.down({ x, y }, {}); tools.up({ x, y }, {}, '0_Floor');
}
function select(tools: TilezedTerrainTools, x: number, y: number, endX: number, endY: number, mods = {}): void {
  tools.setTool('select'); tools.down({ x, y }, mods); tools.up({ x: endX, y: endY }, mods, '0_Floor');
}
describe('Native TileZed terrain tools', () => {
  it('paints ground through the embedded rule and keeps raw tiles separate', async () => {
    const tools = await open(); paint(tools, 2, 3);
    expect(tools.map.bitmaps.get(0)!.pixels[26]).toBe(0x0a0000);
    expect(tools.editor.scene.layers[0].gids[26]).toBe(2);
    expect(tools.map.layers[0].gids[26]).toBe(0);
    expect(tools.editor.dirty).toBeTrue();
  });
  it('interpolates drags and makes a whole brush stroke one undo operation', async () => {
    const tools = await open(); tools.down({ x: 0, y: 0 }, {}); tools.move({ x: 7, y: 0 }, {}); tools.up({ x: 7, y: 0 }, {}, '0_Floor');
    expect([...tools.map.bitmaps.get(0)!.pixels.slice(0, 8)]).toEqual(Array(8).fill(0x0a0000));
    tools.editor.undo(); expect(tools.map.bitmaps.get(0)!.pixels.some(Boolean)).toBeFalse(); expect(tools.editor.canUndo).toBeFalse();
    tools.editor.redo(); expect(tools.editor.scene.layers[0].gids[7]).toBe(2);
  });
  it('never changes source scene bitmaps while editing', async () => {
    const map = await readTilezedMap(xml); map.bitmaps.set(0, { seed: 37, pixels: new Uint32Array(64) });
    const editor = new TilezedEditDocument(xml, generateTilezedScene(map)), tools = new TilezedTerrainTools(editor); paint(tools, 0, 0);
    expect(map.bitmaps.get(0)!.pixels[0]).toBe(0); expect(editor.scene.map.bitmaps.get(0)!.seed).toBe(37);
  });
  it('clips large square brushes to map bounds and supports sizes up to 300', async () => {
    const tools = await open(); tools.size = 300; expect(tools.brush({ x: 0, y: 0 }).size).toBe(64);
    tools.size = 2; expect([...tools.brush({ x: 0, y: 0 })]).toEqual([0]);
  });
  it('matches native two- and four-pixel circular brushes', async () => {
    const tools = await open(); tools.shape = 'circle'; tools.size = 2;
    expect([...tools.brush({ x: 3, y: 3 })].sort()).toEqual([18, 19, 26, 27]);
    tools.size = 4; const circle = tools.brush({ x: 3, y: 3 });
    expect(circle.size).toBe(12); expect(circle.has(9)).toBeFalse(); expect(circle.has(10)).toBeTrue();
  });
  it('uses custom brush mask pixels instead of its rectangular bounds', async () => {
    const tools = await open(); tools.shape = 'custom'; tools.custom = { width: 3, height: 2, pixels: Uint8Array.of(1, 0, 1, 0, 1, 0) };
    expect([...tools.brush({ x: 3, y: 3 })]).toEqual([18, 20, 27]);
  });
  it('paints filled rectangles and waits until release to commit', async () => {
    const tools = await open(); tools.setTool('rectangle'); tools.down({ x: 1, y: 1 }, {}); tools.move({ x: 3, y: 2 }, {});
    expect(tools.map.bitmaps.size).toBe(0); tools.up({ x: 3, y: 2 }, {}, '0_Floor');
    expect(tools.map.bitmaps.get(0)!.pixels.filter(Boolean).length).toBe(6); tools.editor.undo(); expect(tools.map.bitmaps.get(0)!.pixels.some(Boolean)).toBeFalse();
  });
  it('constrains rectangles to squares with Shift', async () => {
    const tools = await open(); tools.setTool('rectangle'); tools.down({ x: 2, y: 2 }, { shiftKey: true }); tools.up({ x: 4, y: 3 }, { shiftKey: true }, '0_Floor');
    expect(tools.map.bitmaps.get(0)!.pixels.filter(Boolean).length).toBe(9);
  });
  it('erases only the selected bitmap, including Ctrl-paint', async () => {
    const tools = await open(); paint(tools, 2, 2); tools.chooseBitmap(1); paint(tools, 2, 2, 0x00ff00);
    tools.setTool('eraser'); paint(tools, 2, 2);
    expect(tools.map.bitmaps.get(1)!.pixels[18]).toBe(0); expect(tools.map.bitmaps.get(0)!.pixels[18]).toBe(0x0a0000);
    tools.chooseBitmap(0); tools.setTool('brush'); tools.down({ x: 2, y: 2 }, { ctrlKey: true }); tools.up({ x: 2, y: 2 }, { ctrlKey: true }, '0_Floor');
    expect(tools.map.bitmaps.get(0)!.pixels[18]).toBe(0);
  });
  it('restricts brush strokes to an arbitrary selected region', async () => {
    const tools = await open(); tools.selection = new Set([0, 9]); tools.restrict = true; tools.size = 5; paint(tools, 1, 1);
    expect([...tools.map.bitmaps.get(0)!.pixels.entries()].filter(([, color]) => !!color).map(([index]) => index)).toEqual([0, 9]);
  });
  it('treats an empty selection as unrestricted', async () => {
    const tools = await open(); tools.restrict = true; paint(tools, 1, 1); expect(tools.map.bitmaps.get(0)!.pixels[9]).toBeTruthy();
  });
  it('floods diagonal matching pixels without wrapping at row boundaries', async () => {
    const tools = await open(); tools.map.bitmaps.set(0, { seed: 5, pixels: Uint32Array.from({ length: 64 }, (_, i) => [0, 9, 7, 8].includes(i) ? 10 : 20) });
    expect([...tools.flood({ x: 0, y: 0 })].sort()).toEqual([0, 8, 9]);
  });
  it('fills all matching selected pixels when enabled, including disconnected areas', async () => {
    const tools = await open(); tools.map.bitmaps.set(0, { seed: 5, pixels: Uint32Array.from({ length: 64 }, (_, i) => [0, 63].includes(i) ? 0x140000 : 0x0a0000) });
    tools.selection = new Set([0, 1, 63]); tools.restrict = true; tools.fillAll = true; tools.setTool('bucket'); paint(tools, 0, 0);
    expect(tools.map.bitmaps.get(0)!.pixels[63]).toBe(0x0a0000); expect(tools.map.bitmaps.get(0)!.pixels[1]).toBe(0x0a0000);
  });
  it('floods before clipping to selection, so the selection is not a flood barrier', async () => {
    const tools = await open(); tools.selection = new Set([0, 63]); tools.restrict = true; tools.setTool('bucket'); paint(tools, 0, 0);
    expect(tools.map.bitmaps.get(0)!.pixels.filter(Boolean).length).toBe(2);
  });
  it('adds, subtracts, intersects and undoes terrain selections without marking the map dirty', async () => {
    const tools = await open(); select(tools, 0, 0, 1, 0); select(tools, 3, 0, 3, 0, { ctrlKey: true });
    expect([...tools.selection]).toEqual([0, 1, 3]); select(tools, 1, 0, 1, 0, { shiftKey: true }); expect([...tools.selection]).toEqual([0, 3]);
    select(tools, 0, 0, 1, 0, { ctrlKey: true, shiftKey: true }); expect([...tools.selection]).toEqual([0]);
    tools.editor.undo(); expect([...tools.selection]).toEqual([0, 3]); expect(tools.editor.dirty).toBeFalse();
    tools.selection.clear(); tools.editor.redo(); expect([...tools.selection]).toEqual([0]);
  });
  it('selects same-colour terrain with the magic wand', async () => {
    const tools = await open(); paint(tools, 1, 1); paint(tools, 2, 2); tools.setTool('wand'); tools.down({ x: 1, y: 1 }, {});
    expect([...tools.selection].sort()).toEqual([18, 9]);
  });
  it('moves overlapping selections from a snapshot in one undo command', async () => {
    const tools = await open(); paint(tools, 0, 0); paint(tools, 1, 0, 0x140000); tools.selection = new Set([0, 1]); tools.moveSelection(1, 0);
    expect([...tools.map.bitmaps.get(0)!.pixels.slice(0, 3)]).toEqual([0, 0x0a0000, 0x140000]); expect([...tools.selection]).toEqual([1, 2]);
    tools.editor.undo(); expect([...tools.map.bitmaps.get(0)!.pixels.slice(0, 3)]).toEqual([0x0a0000, 0x140000, 0]); expect([...tools.selection]).toEqual([0, 1]);
  });
  it('copies both bitmap channels while preserving the source when requested', async () => {
    const tools = await open(); paint(tools, 0, 0); tools.chooseBitmap(1); paint(tools, 0, 0, 0x00ff00); tools.selection = new Set([0]); tools.moveSelection(2, 0, true, true);
    for (const b of [0, 1]) expect(tools.map.bitmaps.get(b)!.pixels[2]).toBe(tools.map.bitmaps.get(b)!.pixels[0]);
    tools.editor.undo(); expect(tools.map.bitmaps.get(1)!.pixels[2]).toBe(0); expect(tools.map.bitmaps.get(1)!.pixels[0]).toBe(0x00ff00);
  });
  it('copies and pastes irregular regions, including black pixels, without touching holes', async () => {
    const tools = await open(); paint(tools, 0, 0); tools.selection = new Set([0, 9]); tools.copy();
    expect(tools.pasting).toBeFalse(); paint(tools, 4, 3); paint(tools, 4, 4); tools.startPaste(); tools.down({ x: 3, y: 3 }, {});
    expect(tools.map.bitmaps.get(0)!.pixels[27]).toBe(0x0a0000); expect(tools.map.bitmaps.get(0)!.pixels[28]).toBe(0x0a0000); expect(tools.map.bitmaps.get(0)!.pixels[36]).toBe(0);
    tools.cancel(); expect(tools.pasting).toBeFalse(); expect(tools.clipboard).toBeDefined();
  });
  it('picks the active bitmap colour', async () => {
    const tools = await open(); paint(tools, 3, 2, 0x140000); tools.setTool('pick'); tools.down({ x: 3, y: 2 }, {}); expect(tools.color).toBe(0x140000);
  });
  it('copies both bitmaps for native clipboard paste, even when the active channel changes', async () => {
    const tools = await open(); paint(tools, 0, 0); tools.chooseBitmap(1); paint(tools, 0, 0, 0x00ff00);
    tools.selection = new Set([0]); tools.copy(); tools.chooseBitmap(0); tools.setTool('pick'); tools.startPaste(); tools.down({ x: 3, y: 3 }, {});
    expect(tools.map.bitmaps.get(0)!.pixels[27]).toBe(0x0a0000); expect(tools.map.bitmaps.get(1)!.pixels[27]).toBe(0x00ff00);
    tools.editor.undo(); expect(tools.map.bitmaps.get(0)!.pixels[27]).toBe(0); expect(tools.map.bitmaps.get(1)!.pixels[27]).toBe(0);
  });
  it('keeps manually painted tiles protected when BMP terrain is painted underneath', async () => {
    const tools = await open(); tools.editor.paintCells('0_Floor', [{ point: { x: 0, y: 0 }, gid: 7 }]); paint(tools, 0, 0);
    expect(tools.editor.scene.layers[0].gids[0]).toBe(7); tools.editor.undo(); expect(tools.editor.scene.layers[0].gids[0]).toBe(7);
  });
  it('bakes visible terrain, clears both BMPs and restores everything on undo', async () => {
    const tools = await open(); paint(tools, 3, 3); tools.chooseBitmap(1); paint(tools, 3, 3, 0x00ff00); tools.setTool('bake'); paint(tools, 3, 3);
    expect(tools.map.layers[0].gids[27]).toBe(2); expect(tools.map.layers[2].gids[27]).toBe(3);
    const saved = await readTilezedMap(await tools.editor.serialize()); expect(saved.layers[0].gids[27]).toBe(2); expect(saved.layers[2].gids[27]).toBe(3);
    expect(tools.map.bitmaps.get(0)!.pixels[27]).toBe(0); expect(tools.map.bitmaps.get(1)!.pixels[27]).toBe(0);
    expect(tools.editor.scene.layers[0].gids[27]).toBe(2); tools.editor.undo();
    expect(tools.map.layers[0].gids[27]).toBe(0); expect(tools.map.bitmaps.get(0)!.pixels[27]).toBe(0x0a0000); expect(tools.map.bitmaps.get(1)!.pixels[27]).toBe(0x00ff00);
  });
  it('preserves edge blend tiles within two squares of a baked region', async () => {
    const tools = await open(); tools.map.bitmaps.set(0, { seed: 0, pixels: new Uint32Array(64).fill(0x140000) });
    paint(tools, 3, 3); expect(tools.editor.scene.layers[1].gids[35]).toBe(4);
    tools.setTool('bake'); paint(tools, 3, 3); expect(tools.map.layers[1].gids[35]).toBe(4); expect(tools.editor.scene.layers[1].gids[35]).toBe(4);
  });
  it('toggles no-blend masks, clears raw blend tiles and supports undo', async () => {
    const tools = await open(); paint(tools, 3, 3); tools.editor.paintCells('0_FloorOverlay', [{ point: { x: 3, y: 4 }, gid: 4 }]);
    tools.setTool('no-blend'); tools.down({ x: 3, y: 4 }, {}); tools.up({ x: 3, y: 4 }, {}, '0_FloorOverlay');
    expect(tools.map.noBlend!.get('0_FloorOverlay')![35]).toBe(0); expect(tools.map.layers[1].gids[35]).toBe(0);
    tools.editor.undo(); expect(tools.map.noBlend!.get('0_FloorOverlay')![35]).toBe(1); expect(tools.map.layers[1].gids[35]).toBe(4);
  });
  it('shows generated, raw and FloorOverlay layers independently without mutating the map', async () => {
    const tools = await open(); paint(tools, 3, 3);
    const raw = generateTilezedScene(tools.map, { bmp: false, map: true, overlays: true }); expect(raw.layers[0].gids[27]).toBe(0);
    const generated = generateTilezedScene(tools.map, { bmp: true, map: false, overlays: false }); expect(generated.layers[0].gids[27]).toBe(2); expect(generated.layers[1].visible).toBeFalse(); expect(tools.map.layers[1].visible).toBeTrue();
  });
  it('applies the active layer no-blend result to all blend layers with Shift', async () => {
    const tools = await open(); tools.map.blends.push({ ...tools.map.blends[0], layer: '0_Vegetation' });
    tools.map.noBlend!.set('0_Vegetation', new Uint8Array(64).fill(1)); tools.setTool('no-blend');
    tools.down({ x: 0, y: 0 }, { shiftKey: true }); tools.up({ x: 1, y: 0 }, { shiftKey: true }, '0_FloorOverlay');
    expect(tools.map.noBlend!.get('0_FloorOverlay')![0]).toBe(1); expect(tools.map.noBlend!.get('0_Vegetation')![0]).toBe(1);
    tools.editor.undo(); expect(tools.map.noBlend!.get('0_FloorOverlay')![0]).toBe(0); expect(tools.map.noBlend!.get('0_Vegetation')![0]).toBe(1);
  });
  it('saves edited BMP palettes, seeds, masks and unrelated map metadata in native TMX format', async () => {
    const tools = await open(); tools.map.bitmaps.set(0, { seed: 0xffffffff, pixels: new Uint32Array(64) }); paint(tools, 3, 3);
    tools.setTool('no-blend'); tools.down({ x: 3, y: 4 }, {}); tools.up({ x: 3, y: 4 }, {}, '0_FloorOverlay');
    const saved = await tools.editor.serialize(), map = await readTilezedMap(saved);
    expect(map.bitmaps.get(0)!.seed).toBe(0xffffffff); expect([...map.bitmaps.get(0)!.pixels]).toEqual([...tools.map.bitmaps.get(0)!.pixels]);
    expect(map.noBlend!.get('0_FloorOverlay')![35]).toBe(1); expect(saved).toContain('<extension keep="yes"'); expect(saved).toContain('custom="keep"');
    expect([...generateTilezedScene(map).layers[0].gids]).toEqual([...tools.editor.scene.layers[0].gids]);
  });
  it('shares undo and saved-state tracking with manual tile edits', async () => {
    const tools = await open(); paint(tools, 1, 1); tools.editor.markSaved(); tools.editor.paintCells('0_Floor', [{ point: { x: 2, y: 2 }, gid: 8 }]);
    tools.editor.undo(); expect(tools.editor.dirty).toBeFalse(); tools.editor.undo(); expect(tools.editor.dirty).toBeTrue(); tools.editor.redo(); expect(tools.editor.dirty).toBeFalse();
  });
  it('imports and exports native multiline Rules.txt aliases and conditions', async () => {
    const tools = await open(), settings = readTerrainSettings(`version = 1\nalias\n{\n name = mixed\n tiles = [\n ground_01_000\n ground_01_001\n ]\n}\nrule\n{\n label = Mixed grass\n bitmap = 0\n color = 1 2 3\n condition = 4 5 6\n layer = 0_Floor\n tiles = mixed null\n}`, 'rules', terrainSettings(tools.map));
    expect(settings.aliases.get('mixed')).toEqual(['ground_01_000', 'ground_01_001']); expect(settings.rules[0].label).toBe('Mixed grass');
    expect(readTerrainSettings(writeTerrainSettings(settings, 'rules'), 'rules', settings)).toEqual(settings);
  });
  it('imports and exports Blends.txt including tile/layer exclusions', async () => {
    const tools = await open(), settings = readTerrainSettings('version = 1\nblend\n{\n layer = 0_FloorOverlay\n mainTile = grass\n blendTile = ground_01_003\n dir = ne\n exclude = ground_01_002\n exclude2 = ground_01 0_Vegetation\n}', 'blends', terrainSettings(tools.map));
    expect(settings.blends[0].excludedLayers).toEqual([{ tile: 'ground_01', layer: '0_Vegetation' }]);
    expect(readTerrainSettings(writeTerrainSettings(settings, 'blends'), 'blends', settings)).toEqual(settings);
  });
  it('keeps imported settings and edge options undoable and persists them', async () => {
    const tools = await open(); const before = terrainSettings(tools.map), after = { ...before, blendEdgesEverywhere: true, rules: before.rules.map(rule => ({ ...rule, label: 'Label' })) };
    tools.editor.changeTerrainSettings(after); tools.editor.undo(); expect(tools.map.blendEdgesEverywhere).toBeFalse(); tools.editor.redo();
    const map = await readTilezedMap(await tools.editor.serialize()); expect(map.blendEdgesEverywhere).toBeTrue(); expect(map.rules[0].label).toBe('Label');
  });
  it('rejects malformed settings without changing the map', async () => {
    const tools = await open();
    for (const source of ['version = 2', 'rule\n{', 'rule\n{\nbitmap = 4\ncolor = 1 2 3\n}', 'blend\n{\ndir = nn\n}']) expect(() => readTerrainSettings(source, 'rules', terrainSettings(tools.map))).toThrow();
    expect(tools.editor.dirty).toBeFalse();
    const after = { ...terrainSettings(tools.map), aliases: new Map([['grass', ['grass']]]) };
    expect(() => tools.editor.changeTerrainSettings(after)).toThrowError(/cycle/); expect(tools.editor.dirty).toBeFalse();
  });
});
