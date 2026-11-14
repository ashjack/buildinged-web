import { readTilezedMap } from './tilezed-map';
import { generateTilezedScene } from './tilezed-terrain';
import { TilezedEditDocument, tileLine, tilezedTileAtPixel } from './tilezed-edit';
import { tilezedBuildingPlacement } from './tilezed-building-placement';

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

const layeredXml = xml.replace('<objectgroup',
  '<layer name="Detail" level="0" width="4" height="3" opacity="0.5" custom="retain"><properties><property name="tag" value="detail"/></properties>' +
  '<data encoding="csv">3,0,0,0,0,0,0,0,0,0,0,0</data></layer>' +
  '<layer name="0_Overlay" width="4" height="3" visible="0"><data encoding="csv">0,2,0,0,0,0,0,0,0,0,0,0</data></layer><objectgroup');

describe('TileZed manual editing document', () => {
  it('moves and deletes existing TMX lots without duplicating them or changing group metadata', async () => {
    const source = xml.replace('<extension', '<objectgroup name="2_Buildings" custom="keep"><properties><property name="group" value="keep"/></properties>' +
      '<object id="17" name="lot" type="Buildings/house.tbx" x="32" y="64" width="64" height="96" custom="retain"><properties><property name="room" value="keep"/></properties></object>' +
      '<object name="zone" type="ParkingStall" x="0" y="0" width="32" height="32"/></objectgroup><extension');
    const editor = await open(source), original = editor.lots[0];
    expect(editor.placementsDirty).toBeFalse(); expect(original.level).toBe(2);
    expect(editor.moveBuilding(original, { x: 1, y: 2 })).toBe(original); expect(editor.canUndo).toBeFalse();
    const moved = editor.moveBuilding(original, { x: -2, y: 4 })!;
    expect(moved).toEqual({ ...original, x: -2, y: 4 }); expect(original.x).toBe(1);
    const saved = await editor.serialize(), parsed = new DOMParser().parseFromString(saved, 'text/xml');
    expect((await readTilezedMap(saved)).lots).toEqual([moved]);
    expect(parsed.querySelectorAll('object[name="lot"]').length).toBe(1);
    expect(parsed.querySelector('object[id="17"]')?.getAttribute('custom')).toBe('retain');
    expect(parsed.querySelector('object[id="17"] property')?.getAttribute('value')).toBe('keep');
    editor.markSaved(); expect(editor.placementsDirty).toBeFalse();
    expect(editor.removeBuilding(moved)).toBeTrue(); expect(editor.lots).toEqual([]);
    expect((await readTilezedMap(await editor.serialize())).lots).toEqual([]);
    expect((await editor.serialize())).toContain('name="zone"');
    editor.undo(); expect(editor.lots).toEqual([moved]); expect(editor.dirty).toBeFalse();
    editor.undo(); expect(editor.lots).toEqual([original]); expect(editor.placementsDirty).toBeTrue();
    editor.redo(); expect(editor.lots).toEqual([moved]); expect(editor.dirty).toBeFalse();
  });

  it('keeps duplicate WorldEd placements independent, preserves order, and rebases save identities', async () => {
    const scene = generateTilezedScene(await readTilezedMap(xml));
    const a = { x: 1, y: 1, width: 2, height: 2, level: -1, map: 'Buildings/a.tbx' };
    const b = { ...a };
    const editor = new TilezedEditDocument(xml, scene, [a, b]);
    const moved = editor.moveBuilding(b, { x: 4, y: 5 })!;
    expect(editor.worldLotsForSave()).toEqual([{ ...a, sourceIndex: 0 }, { ...moved, sourceIndex: 1 }]);
    editor.removeBuilding(a); expect(editor.lots).toEqual([moved]);
    editor.undo(); expect(editor.lots).toEqual([a, moved]);
    expect((await readTilezedMap(await editor.serialize(false))).lots).toEqual([]);
    expect((await readTilezedMap(await editor.serialize())).lots).toEqual([a, moved]);
    editor.removeBuilding(a); editor.markSaved();
    expect(editor.worldLotsForSave()).toEqual([{ ...moved, sourceIndex: 0 }]);
    expect(editor.removeBuilding(a)).toBeFalse();
    expect(editor.moveBuilding(moved, { x: NaN, y: 0 })).toBeUndefined();
  });

  it('serializes repeated saves from the source without resurrecting deleted or duplicating new lots', async () => {
    const editor = await open();
    const lot = { x: 0, y: 0, width: 1, height: 1, level: 0, map: 'new.tbx' };
    editor.placeBuilding(lot); editor.markSaved();
    const moved = editor.moveBuilding(editor.lots[0], { x: 2, y: 1 })!;
    expect((await readTilezedMap(await editor.serialize())).lots).toEqual([moved]);
    editor.markSaved(); expect((await readTilezedMap(await editor.serialize())).lots).toEqual([moved]);
    editor.removeBuilding(moved); expect((await readTilezedMap(await editor.serialize())).lots).toEqual([]);
  });
  it('raises and lowers the draw stack while keeping layer contents, generated tiles and masks together', async () => {
    const editor = await open(layeredXml);
    const raw = editor.scene.map.layers[0], visible = editor.scene.layers[0];
    visible.gids[0] = 2; // A generated BMP tile can differ from the stored tile.
    const mask = Uint8Array.from({ length: 12 }, (_, i) => i === 1 ? 1 : 0);
    editor.scene.map.noBlend!.set(raw.name, mask);
    expect(editor.moveLayer(raw.name, 'up')).toBeTrue();
    expect(editor.scene.map.layers.map(layer => layer.name)).toEqual(['0_Detail', '0_Floor', '0_Overlay']);
    expect(editor.scene.layers.map(layer => layer.name)).toEqual(['0_Detail', '0_Floor', '0_Overlay']);
    expect(editor.scene.map.layers[1]).toBe(raw); expect(editor.scene.layers[1]).toBe(visible);
    expect(editor.scene.map.layers[1].gids[0]).toBe(1); expect(editor.scene.layers[1].gids[0]).toBe(2);
    expect(editor.scene.map.noBlend!.get(raw.name)).toBe(mask);
    expect(editor.moveLayer(raw.name, 'down')).toBeTrue();
    expect(editor.scene.map.layers[0]).toBe(raw); expect(editor.scene.layers[0]).toBe(visible);
  });

  it('round trips the reordered ground layers while preserving native XML, upper levels and object groups', async () => {
    const editor = await open(layeredXml);
    editor.moveLayer('0_Floor', 'up');
    const saved = await editor.serialize(), reloaded = await open(saved);
    expect(reloaded.scene.map.layers.map(layer => layer.name)).toEqual(['0_Detail', '0_Floor', '0_Overlay']);
    const source = new DOMParser().parseFromString(layeredXml, 'application/xml');
    const result = new DOMParser().parseFromString(saved, 'application/xml');
    const originalChildren = Array.from(source.documentElement.children), savedChildren = Array.from(result.documentElement.children);
    for (let i = 0; i < originalChildren.length; i++) {
      const child = originalChildren[i];
      if (child.tagName !== 'layer' || child.getAttribute('name') === '1_Floor') expect(savedChildren[i].outerHTML).toBe(child.outerHTML);
    }
    for (const name of ['0_Floor', 'Detail', '0_Overlay'])
      expect(result.querySelector(`layer[name="${name}"]`)!.outerHTML).toBe(source.querySelector(`layer[name="${name}"]`)!.outerHTML);
    expect(reloaded.scene.map.layers[0].opacity).toBe(0.5); expect(reloaded.scene.map.layers[2].visible).toBeFalse();
    expect(saved).not.toContain('layer-order');
    expect(editor.scene.map.layers[0].name).toBe('0_Detail');
  });

  it('keeps layer moves in undo order with layer creation and painting across a manual save', async () => {
    const editor = await open(layeredXml), name = editor.addLayer('New');
    editor.moveLayer(name, 'down');
    editor.paintCells(name, [{ point: { x: 0, y: 0 }, gid: 2 }]);
    editor.markSaved(); expect(editor.dirty).toBeFalse();
    editor.undo(); expect(editor.dirty).toBeTrue();
    editor.undo(); expect(editor.scene.map.layers.at(-1)?.name).toBe(name);
    editor.undo(); expect(editor.scene.map.layers.some(layer => layer.name === name)).toBeFalse();
    editor.redo(); editor.redo(); editor.redo(); expect(editor.dirty).toBeFalse();
    expect(editor.scene.map.layers.map(layer => layer.name)).toEqual(['0_Floor', '0_Detail', name, '0_Overlay']);
    const saved = await readTilezedMap(await editor.serialize());
    expect(saved.layers[2].gids[0]).toBe(2); expect(saved.noBlend!.get(name)![0]).toBe(1);
    editor.undo(); editor.moveLayer('0_Floor', 'up'); expect(editor.canRedo).toBeFalse();
  });

  it('ignores moves beyond the stack edges or of missing layers without dirtying or clearing redo', async () => {
    const editor = await open(layeredXml);
    expect(editor.canMoveLayer('0_Floor', 'down')).toBeFalse();
    expect(editor.canMoveLayer('0_Overlay', 'up')).toBeFalse();
    expect(editor.moveLayer('0_Floor', 'down')).toBeFalse();
    expect(editor.moveLayer('0_Overlay', 'up')).toBeFalse();
    expect(editor.moveLayer('missing', 'up')).toBeFalse();
    expect(editor.dirty).toBeFalse(); expect(editor.canUndo).toBeFalse();
    editor.moveLayer('0_Floor', 'up'); editor.undo(); expect(editor.dirty).toBeFalse();
    editor.moveLayer('0_Floor', 'down'); expect(editor.canRedo).toBeTrue();
    expect((await open(await editor.serialize())).scene.map.layers.map(layer => layer.name)).toEqual(['0_Floor', '0_Detail', '0_Overlay']);
  });
  it('keeps building placements in undo order with tile edits and serializes native TMX lot objects only for local maps', async () => {
    expect(tilezedBuildingPlacement({ path: 'house.tbx', width: 24, height: 20 }, { x: 10.2, y: 15.8 }))
      .toEqual({ map: 'house.tbx', width: 24, height: 20, level: 0, x: -2, y: 6 });
    const editor = await open(), original = editor.scene.map.layers[0].gids.slice();
    const lot = { x: 1, y: -1, width: 2, height: 3, level: 0, map: '../Buildings/house.tbx' };
    editor.placeBuilding(lot);
    expect(editor.dirty).toBeTrue(); expect(editor.placementsDirty).toBeTrue();
    expect(Array.from(editor.scene.layers[0].gids)).toEqual(Array.from(original));
    expect((await readTilezedMap(await editor.serialize())).lots).toEqual([lot]);
    expect((await readTilezedMap(await editor.serialize(false))).lots).toEqual([]);
    editor.markSaved(); expect(editor.placementsDirty).toBeFalse();
    editor.paintCells('0_Floor', [{ point: { x: 0, y: 0 }, gid: 3 }]);
    editor.undo(); expect(editor.dirty).toBeFalse(); expect(editor.placedLots).toEqual([lot]);
    editor.undo(); expect(editor.dirty).toBeTrue(); expect(editor.placementsDirty).toBeTrue();
    expect((await readTilezedMap(await editor.serialize())).lots).toEqual([]);
    editor.redo(); expect(editor.dirty).toBeFalse(); expect(editor.placementsDirty).toBeFalse();
    editor.redo(); expect(editor.scene.layers[0].gids[0]).toBe(3);
  });

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
