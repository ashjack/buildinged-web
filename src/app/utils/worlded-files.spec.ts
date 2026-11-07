import { resolveWorldedProject, worldedFileFor, worldedReferenceKey, worldedVegetationPath } from './worlded-files';
import { readWorldedWorld } from './worlded-world';

describe('WorldEd project file resolution', () => {
  const xml = `<world width="1" height="1">
    <bmp path="images/terrain.png" x="0" y="0" width="1" height="1"/>
    <cell x="0" y="0" map="../shared/cell.tmx"/>
  </world>`;
  const world = readWorldedWorld(xml);
  const original = new File([xml], 'world.pzw');
  const file = (path: string, content: string): File => {
    const entry = new File([content], path.split('/').pop()!);
    Object.defineProperty(entry, 'webkitRelativePath', { value: path });
    return entry;
  };

  it('normalizes relative references and rejects absolute paths', () => {
    expect(worldedReferenceKey('.\\maps\\sub\\..\\cell.tmx')).toBe('maps/cell.tmx');
    expect(worldedReferenceKey('../shared/cell.tmx')).toBe('../shared/cell.tmx');
    expect(worldedReferenceKey('maps/ house .tmx')).toBe('maps/ house .tmx');
    expect(worldedReferenceKey('C:\\project\\cell.tmx')).toBeUndefined();
    expect(worldedReferenceKey('/project/cell.tmx')).toBeUndefined();
    expect(worldedReferenceKey('https://example.test/cell.tmx')).toBeUndefined();
    expect(worldedVegetationPath('images/terrain.png')).toBe('images/terrain_veg.png');
  });

  it('resolves referenced files inside the selected parent and ignores unrelated files', async () => {
    const ground = file('Root/Project/images/terrain.png', 'ground');
    const vegetation = file('Root/Project/images/terrain_veg.png', 'vegetation');
    const map = file('Root/shared/cell.tmx', 'map');
    const result = await resolveWorldedProject([
      file('Root/Project/world.pzw', xml), ground, vegetation, map, file('Root/Project/unrelated.txt', 'private'),
    ], original, world);

    expect(result.folderName).toBe('Root');
    expect(worldedFileFor(result.files, 'images/terrain.png')).toBe(ground);
    expect(worldedFileFor(result.files, 'images/terrain_veg.png')).toBe(vegetation);
    expect(worldedFileFor(result.files, '../shared/cell.tmx')).toBe(map);
    expect(result.files.size).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it('reports references outside the selected folder and missing assets', async () => {
    const result = await resolveWorldedProject([file('Project/world.pzw', xml)], original, world);
    expect(result.files.size).toBe(0);
    expect(result.warnings.join(' ')).toContain('outside the selected folder');
    expect(result.warnings.join(' ')).toContain('terrain image');
    expect(result.warnings.join(' ')).toContain('vegetation image');
  });

  it('requires the selected folder to contain the same world copy', async () => {
    await expectAsync(resolveWorldedProject([file('Root/world.pzw', 'different')], original, world))
      .toBeRejectedWithError(/different copy/);
    await expectAsync(resolveWorldedProject([file('Root/not-world.pzw', xml)], original, world))
      .toBeRejectedWithError(/does not contain/);
    await expectAsync(resolveWorldedProject([
      file('Root/a/world.pzw', xml), file('Root/b/world.pzw', xml),
    ], original, world)).toBeRejectedWithError(/multiple matching/);
  });

  it('includes referenced TBX buildings only once', async () => {
    const worldXml = '<world width="1" height="1"><cell x="0" y="0">' +
      '<lot map="Buildings/house.tbx"/><lot map="Buildings/house.tbx"/></cell></world>';
    const building = file('Project/Buildings/house.tbx', '<building/>');
    const result = await resolveWorldedProject([file('Project/world.pzw', worldXml), building],
      new File([worldXml], 'world.pzw'), readWorldedWorld(worldXml));
    expect(result.files.size).toBe(1);
    expect(worldedFileFor(result.files, 'Buildings/house.tbx')).toBe(building);
  });
});
