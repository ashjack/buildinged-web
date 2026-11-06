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
});
