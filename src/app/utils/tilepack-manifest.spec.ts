import { parseTilepackManifest } from './tilepack-manifest';

describe('tilepack manifest', () => {
  it('reads the same pack metadata used by BuildingEd and ignores incomplete entries', () => {
    expect(parseTilepackManifest([
      { Name: 'Vanilla', Url: 'vanilla.zip', Version: 123 },
      { Name: 'Custom', Url: 'custom.json' },
      { Name: 'Missing URL' },
      null,
    ])).toEqual([
      { name: 'Vanilla', url: 'vanilla.zip', enabled: false, version: '123' },
      { name: 'Custom', url: 'custom.json', enabled: false, version: undefined },
    ]);
  });

  it('rejects a malformed manifest', () => {
    expect(() => parseTilepackManifest({ Name: 'Vanilla' })).toThrowError(/not a list/);
  });

  it('keeps admin availability separate from a user enabling a pack', () => {
    const packs = parseTilepackManifest([
      { Name: 'Hidden', Url: 'hidden.zip', Disabled: true, Required: false },
      { Name: 'Mandatory', Url: 'required.zip', Required: true },
      { Name: 'Optional', Url: 'optional.zip', Disabled: 'true', Required: 'true' },
    ]);
    expect(packs.map(pack => [pack.disabled, pack.required, pack.enabled])).toEqual([
      [true, false, false], [undefined, true, false], [false, false, false],
    ]);
  });
});
