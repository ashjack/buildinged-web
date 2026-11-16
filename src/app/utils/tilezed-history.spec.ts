import { TilezedEditDocument } from './tilezed-edit';
import { readTilezedMap } from './tilezed-map';
import { generateTilezedScene } from './tilezed-terrain';
import { TilezedTerrainTools } from './tilezed-terrain-tools';

const xml = `<map orientation="levelisometric" width="48" height="48" tilewidth="64" tileheight="32">
  <tileset firstgid="1" name="ground" tilewidth="64" tileheight="128"><image source="ground.png" width="512" height="128"/></tileset>
  ${['0_Floor', '0_FloorOverlay', '0_Vegetation'].map((name, layer) => `<layer name="${name}" width="48" height="48"><data encoding="csv">${Array(48 * 48).fill(layer ? 0 : 1).join(',')}</data></layer>`).join('')}
  <bmp-settings><aliases><alias name="grass" tiles="ground_001 ground_002"/></aliases><rules>
    <rule bitmapIndex="0" color="10 0 0" targetLayer="0_Floor" tileChoices="grass"/>
    <rule bitmapIndex="0" color="20 0 0" targetLayer="0_Floor" tileChoices="ground_000"/>
    <rule bitmapIndex="1" color="0 255 0" condition="10 0 0" targetLayer="0_Vegetation" tileChoices="ground_003 ground_004"/>
  </rules><blends><blend targetLayer="0_FloorOverlay" mainTile="grass" blendTile="ground_005" dir="n"/></blends></bmp-settings>
</map>`;
async function open(): Promise<TilezedEditDocument> { return new TilezedEditDocument(xml, generateTilezedScene(await readTilezedMap(xml))); }
function paint(tools: TilezedTerrainTools, x = 20, y = 20): void {
  tools.down({ x, y }, {}); tools.up({ x, y }, {}, '0_Floor');
}
function expectGenerated(editor: TilezedEditDocument): void {
  const full = generateTilezedScene(editor.scene.map);
  full.layers.forEach((layer, i) => expect([...editor.scene.layers[i].gids]).withContext(layer.name).toEqual([...layer.gids]));
}
describe('Regional TileZed undo and redo', () => {
  it('regenerates a single terrain cell and its blend neighbours without replacing whole-map buffers', async () => {
    const editor = await open(), tools = new TilezedTerrainTools(editor);
    paint(tools); const layers = editor.scene.layers.slice(), arrays = layers.map(layer => layer.gids);
    for (let i = 0; i < 6; i++) {
      i % 2 ? editor.redo() : editor.undo();
      expect(editor.terrainRegion).toEqual({ x: 18, y: 18, width: 5, height: 5 });
      layers.forEach((layer, index) => { expect(editor.scene.layers[index]).toBe(layer); expect(editor.scene.layers[index].gids).toBe(arrays[index]); });
      expectGenerated(editor);
    }
    expect(editor.dirty).toBeTrue();
    editor.undo(); expect(editor.dirty).toBeFalse();
    editor.redo();
    const reopened = generateTilezedScene(await readTilezedMap(await editor.serialize()));
    reopened.layers.forEach((layer, i) => expect([...layer.gids]).toEqual([...editor.scene.layers[i].gids]));
  });
  it('restores a manual tile and its native no-blend mask while invalidating only that square', async () => {
    const editor = await open(), original = editor.scene.layers[0].gids;
    editor.paintCells('0_Floor', [{ point: { x: 12, y: 14 }, gid: 8 }]); editor.markSaved();
    editor.undo(); expect(editor.terrainRegion).toEqual({ x: 12, y: 14, width: 1, height: 1 });
    expect(editor.scene.layers[0].gids).toBe(original); expect(original[14 * 48 + 12]).toBe(1);
    expect(editor.scene.map.noBlend!.get('0_Floor')![14 * 48 + 12]).toBe(0); expect(editor.dirty).toBeTrue();
    editor.redo(); expect(original[14 * 48 + 12]).toBe(8); expect(editor.dirty).toBeFalse();
    expect(editor.scene.usedSheets[0].maxIndex).toBe(7);
    const map = await readTilezedMap(await editor.serialize());
    expect(map.layers[0].gids[14 * 48 + 12]).toBe(8); expect(map.noBlend!.get('0_Floor')![14 * 48 + 12]).toBe(1);
  });
  it('restores compound bitmap, bake and blend-mask edits with the same result as full generation', async () => {
    const editor = await open(), tools = new TilezedTerrainTools(editor);
    paint(tools); tools.chooseBitmap(1); paint(tools); tools.setTool('bake'); paint(tools);
    tools.setTool('no-blend'); tools.down({ x: 20, y: 21 }, {}); tools.up({ x: 20, y: 21 }, {}, '0_FloorOverlay');
    const after = editor.scene.layers.map(layer => [...layer.gids]);
    for (let i = 0; i < 4; i++) { editor.undo(); expectGenerated(editor); }
    expect(editor.dirty).toBeFalse();
    for (let i = 0; i < 4; i++) { editor.redo(); expectGenerated(editor); }
    editor.scene.layers.forEach((layer, i) => expect([...layer.gids]).toEqual(after[i]));
  });
  it('restores unknown-colour warnings through history without changing the saved map state', async () => {
    const editor = await open(), tools = new TilezedTerrainTools(editor), before = editor.scene.warnings;
    tools.color = 0x123456; paint(tools); const after = editor.scene.warnings;
    expect(after.some(warning => warning.includes('#123456'))).toBeTrue();
    editor.undo(); expect(editor.scene.warnings).toBe(before); expect(editor.dirty).toBeFalse();
    editor.redo(); expect(editor.scene.warnings).toBe(after); expectGenerated(editor);
  });
  it('undoes selection changes without regenerating or invalidating map content', async () => {
    const editor = await open(), tools = new TilezedTerrainTools(editor), revision = editor.terrainRevision, layers = editor.scene.layers;
    tools.setTool('select'); tools.down({ x: 5, y: 5 }, {}); tools.up({ x: 8, y: 8 }, {}, '0_Floor');
    editor.undo(); expect(tools.selection.size).toBe(0); expect(editor.terrainRevision).toBe(revision); expect(editor.scene.layers).toBe(layers);
    editor.redo(); expect(tools.selection.size).toBe(16); expect(editor.dirty).toBeFalse(); expect(editor.terrainRevision).toBe(revision);
  });
});
