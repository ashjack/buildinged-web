import { TilezedTerrainPanelComponent } from './tilezed-terrain-panel.component';
import { TilezedTerrainTools } from '../../utils/tilezed-terrain-tools';

describe('TileZed terrain PNG brushes', () => {
  it('uses native alpha and integer Qt greyscale thresholds', async () => {
    const panel = new TilezedTerrainPanelComponent(); panel.terrain = {} as TilezedTerrainTools;
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 1;
    const ctx = canvas.getContext('2d')!, image = ctx.createImageData(4, 1);
    image.data.set([0, 0, 0, 31, 0, 0, 0, 32, 128, 128, 127, 255, 128, 128, 128, 255]); ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const input = { files: [new File([blob], 'mask.png')], value: 'mask.png' };
    await panel.loadMask({ target: input } as unknown as Event);
    expect(input.value).toBe(''); expect(panel.error).toBe(''); expect(panel.terrain.shape).toBe('custom');
    expect([...panel.terrain.custom!.pixels]).toEqual([0, 1, 1, 0]);
  });
  it('rejects a mask larger than the native brush limit', async () => {
    const panel = new TilezedTerrainPanelComponent(); panel.terrain = {} as TilezedTerrainTools;
    const canvas = document.createElement('canvas'); canvas.width = 301; canvas.height = 1;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    await panel.loadMask({ target: { files: [new File([blob], 'large.png')], value: 'large.png' } } as unknown as Event);
    expect(panel.error).toContain('300'); expect(panel.terrain.custom).toBeUndefined();
  });
});
