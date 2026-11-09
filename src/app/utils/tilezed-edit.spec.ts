import { readTilezedMap } from './tilezed-map';
import { generateTilezedScene } from './tilezed-terrain';
import { TilezedEditDocument, tileLine, tilezedTileAtPixel } from './tilezed-edit';

const xml = `<map orientation="levelisometric" width="4" height="3" tilewidth="64" tileheight="32" custom="keep">
  <properties><property name="note" value="preserve"/></properties>
  <tileset firstgid="1" name="ground" tilewidth="64" tileheight="128"><image source="ground.png" width="192" height="128"/></tileset>
  <layer name="0_Floor" width="4" height="3"><data encoding="csv">1,1,2,1,1,1,2,1,2,2,2,1</data></layer>
  <layer name="1_Floor" width="4" height="3"><data encoding="csv">3,0,0,0,0,0,0,0,0,0,0,0</data></layer>
  <objectgroup name="0_Zones"><object type="ParkingStall" x="32" y="32" width="32" height="32"/></objectgroup>
  <extension untouched="yes"/>
</map>`;

async function open(source = xml): Promise<TilezedEditDocument> {
  return new TilezedEditDocument(source, generateTilezedScene(await readTilezedMap(source)));
}

describe('TileZed manual editing document', () => {
  it('adds an empty layer above the existing stack and saves its tiles without altering other layers', async () => {
    const editor = await open(), original = editor.scene.map.layers[0].gids.slice();
    const name = editor.addLayer('Fences');
    expect(name).toBe('0_Fences'); expect(editor.dirty).toBeTrue();
    expect(editor.scene.map.layers.at(-1)?.name).toBe(name);
    expect(editor.scene.layers.at(-1)?.gids.some(gid => gid !== 0)).toBeFalse();
    let saved = await readTilezedMap(await editor.serialize());
    expect(saved.layers.map(layer => layer.name)).toEqual(['0_Floor', name]);
    expect(Array.from(saved.layers[1].gids)).toEqual(Array(12).fill(0));
    editor.paintCells(name, [{ point: { x: 1, y: 2 }, gid: 3 }]);
    const source = await editor.serialize(); saved = await readTilezedMap(source);
    expect(saved.layers[1].gids[9]).toBe(3);
    expect(Array.from(saved.layers[0].gids)).toEqual(Array.from(original));
    const document = new DOMParser().parseFromString(source, 'application/xml');
    expect(document.querySelector('layer[name="1_Floor"] data')?.textContent).toBe('3,0,0,0,0,0,0,0,0,0,0,0');
    expect(document.querySelector('extension')?.getAttribute('untouched')).toBe('yes');
  });

  it('undoes and redoes layer creation and painting across manual saves without losing the new layer mask', async () => {
    const editor = await open(), name = editor.addLayer('Fences');
    editor.markSaved();
    editor.paintCells(name, [{ point: { x: 0, y: 0 }, gid: 2 }]);
    editor.undo(); expect(editor.dirty).toBeFalse();
    editor.undo(); expect(editor.dirty).toBeTrue();
    expect((await readTilezedMap(await editor.serialize())).layers.map(layer => layer.name)).toEqual(['0_Floor']);
    editor.redo(); expect(editor.dirty).toBeFalse();
    editor.redo(); expect(editor.scene.layers.at(-1)?.gids[0]).toBe(2);
    const reloaded = await readTilezedMap(await editor.serialize());
    expect(reloaded.noBlend?.get(name)?.[0]).toBe(1);
  });

  it('validates new layer names and safely reuses a name after undoing its creation', async () => {
    const editor = await open();
    expect(() => editor.addLayer(' ')).toThrowError('Enter a layer name.');
    expect(() => editor.addLayer('0_Floor')).toThrowError(/already has that name/);
    expect(() => editor.addLayer('1_Roof')).toThrowError(/ground level/);
    expect(editor.dirty).toBeFalse();
    const name = editor.addLayer(editor.suggestedLayerName());
    editor.paintCells(name, [{ point: { x: 0, y: 0 }, gid: 2 }]);
    editor.undo(); editor.undo();
    editor.addLayer(name);
    expect(editor.canRedo).toBeFalse();
    expect((await readTilezedMap(await editor.serialize())).layers.at(-1)?.gids[0]).toBe(0);
  });

  it('counts preserved upper-level layers against the shared map layer limit', async () => {
    const source = xml.replace('</map>', Array.from({ length: 254 }, (_, i) =>
      `<layer name="1_Extra ${i}" width="4" height="3"><data encoding="csv">${Array(12).fill(0).join(',')}</data></layer>`).join('') + '</map>');
    const editor = await open(source);
    expect(editor.canAddLayer).toBeFalse();
    expect(() => editor.addLayer('New layer')).toThrowError(/256/);
    expect(editor.dirty).toBeFalse();
  });
  it('saves newly referenced building/fence tilesheets and keeps a fence drag in one undo operation', async () => {
    const editor = await open();
    editor.scene.map.tilesets.push({ name: 'fencing_01', source: 'Tiles/fencing_01.png', firstGid: 4,
      tileWidth: 64, tileHeight: 128, columns: 8, rows: 16, imageWidth: 512, imageHeight: 2048 });
    editor.selection = { x: 0, y: 0, width: 2, height: 1 };
    editor.paintCells('0_Floor', [0, 1, 2].map(x => ({ point: { x, y: 0 }, gid: 4 + x })));
    expect(Array.from(editor.scene.layers[0].gids.slice(0, 3))).toEqual([4, 5, 2]);
    const reloaded = await readTilezedMap(await editor.serialize());
    expect(reloaded.tilesets[1].name).toBe('fencing_01'); expect(reloaded.layers[0].gids[1]).toBe(5);
    editor.undo(); expect(editor.dirty).toBeFalse();
    expect(Array.from(editor.scene.layers[0].gids.slice(0, 3))).toEqual([1, 1, 2]);
  });
  it('projects screen positions back into tiles with pan, zoom and both tile scales', () => {
    for (const tileWidth of [64, 128]) for (const zoom of [0.25, 1, 3]) {
      const map = { height: 300, tileWidth, tileHeight: tileWidth / 2 };
      const camera = { x: 10000, y: 4000, zoom }, view = { width: 900, height: 700 };
      const x = map.height * tileWidth / 2 + (10.5 - 20.5) * tileWidth / 2, y = (10.5 + 20.5) * tileWidth / 4;
      expect(tilezedTileAtPixel(map, camera, view, view.width / 2 + (x - camera.x) * zoom,
        view.height / 2 + (y - camera.y) * zoom)).toEqual({ x: 10, y: 20 });
    }
  });

  it('stamps rectangular patterns transparently, clips to the selection and groups a stroke for undo', async () => {
    const editor = await open();
    editor.selection = { x: 0, y: 0, width: 2, height: 2 };
    editor.begin('0_Floor');
    editor.stamp({ x: 0, y: 0 }, { width: 2, height: 2, gids: Uint32Array.of(3, 0, 2, 3) });
    editor.stamp({ x: 3, y: 2 }, { width: 1, height: 1, gids: Uint32Array.of(3) });
    editor.finish();
    expect(Array.from(editor.scene.layers[0].gids)).toEqual([3,1,2,1,2,3,2,1,2,2,2,1]);
    expect(editor.dirty).toBeTrue();
    editor.undo();
    expect(Array.from(editor.scene.layers[0].gids)).toEqual([1,1,2,1,1,1,2,1,2,2,2,1]);
    expect(editor.dirty).toBeFalse();
    editor.redo();
    expect(editor.scene.layers[0].gids[0]).toBe(3);
  });

  it('fills only orthogonally connected matching tiles, supports selection fill and never crosses selection boundaries', async () => {
    const editor = await open(), stamp = { width: 1, height: 1, gids: Uint32Array.of(3) };
    editor.fill('0_Floor', { x: 0, y: 0 }, stamp);
    expect(Array.from(editor.scene.layers[0].gids)).toEqual([3,3,2,1,3,3,2,1,2,2,2,1]);
    editor.undo();
    editor.selection = { x: 0, y: 0, width: 1, height: 3 };
    editor.fill('0_Floor', { x: 0, y: 0 }, stamp);
    expect(Array.from(editor.scene.layers[0].gids)).toEqual([3,1,2,1,3,1,2,1,2,2,2,1]);
    editor.undo();
    editor.fill('0_Floor', { x: 0, y: 0 }, stamp, true);
    expect(Array.from(editor.scene.layers[0].gids)).toEqual([3,1,2,1,3,1,2,1,3,2,2,1]);
  });

  it('captures the visible selection as a stamp and erases only the selected layer', async () => {
    const editor = await open();
    editor.selection = { x: 1, y: 0, width: 2, height: 2 };
    expect(Array.from(editor.capture('0_Floor')!.gids)).toEqual([1,2,1,2]);
    editor.eraseSelection('0_Floor');
    expect(Array.from(editor.scene.layers[0].gids)).toEqual([1,0,0,1,1,0,0,1,2,2,2,1]);
    const saved = new DOMParser().parseFromString(await editor.serialize(), 'application/xml');
    expect(saved.querySelector('layer[name="1_Floor"] data')!.textContent).toBe('3,0,0,0,0,0,0,0,0,0,0,0');
  });

  it('keeps undo/redo dirty state accurate across manual saves and discarded redo branches', async () => {
    const editor = await open();
    const paint = (gid: number) => { editor.begin('0_Floor'); editor.stamp({ x: 0, y: 0 }, { width: 1, height: 1, gids: Uint32Array.of(gid) }); editor.finish(); };
    paint(2); editor.markSaved();
    expect(editor.dirty).toBeFalse();
    editor.undo(); expect(editor.dirty).toBeTrue();
    editor.redo(); expect(editor.dirty).toBeFalse();
    editor.undo(); paint(3); expect(editor.canRedo).toBeFalse(); expect(editor.dirty).toBeTrue();
  });

  it('round-trips native no-blend masks so painting and erasing generated BMP terrain survive reopening', async () => {
    const generated = xml.replace('</map>', `<bmp-settings><rules>
      <rule bitmapIndex="0" color="0 0 0" targetLayer="0_Floor" tileChoices="ground_001"/>
      </rules></bmp-settings></map>`);
    const editor = await open(generated);
    expect(editor.scene.layers[0].gids[0]).toBe(2);
    editor.begin('0_Floor'); editor.stamp({ x: 0, y: 0 }, { width: 1, height: 1, gids: Uint32Array.of(3) }); editor.erase({ x: 1, y: 0 }); editor.finish();
    const serialized = await editor.serialize();
    const map = await readTilezedMap(serialized), scene = generateTilezedScene(map);
    expect(Array.from(scene.layers[0].gids).slice(0, 4)).toEqual([3,0,2,2]);
    expect(Array.from(map.noBlend!.get('0_Floor')!).slice(0, 4)).toEqual([1,1,0,0]);
    const root = new DOMParser().parseFromString(serialized, 'application/xml');
    expect(root.documentElement.getAttribute('custom')).toBe('keep');
    expect(root.querySelector('property')?.getAttribute('value')).toBe('preserve');
    expect(root.querySelector('extension')?.getAttribute('untouched')).toBe('yes');
    expect(root.querySelector('bmp-settings rule')).not.toBeNull();
    expect(root.querySelector('object')?.getAttribute('type')).toBe('ParkingStall');
    expect(editor.dirty).toBeTrue(); // Serializing alone never marks a map saved.
  });

  it('interpolates brush strokes in both directions without gaps', () => {
    expect(tileLine({ x: 0, y: 0 }, { x: 4, y: 0 }).map(point => point.x)).toEqual([0,1,2,3,4]);
    expect(tileLine({ x: 4, y: 4 }, { x: 1, y: 1 })).toEqual([{ x:4,y:4 },{ x:3,y:3 },{ x:2,y:2 },{ x:1,y:1 }]);
  });
});
