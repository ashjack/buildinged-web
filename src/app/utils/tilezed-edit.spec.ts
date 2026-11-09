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
