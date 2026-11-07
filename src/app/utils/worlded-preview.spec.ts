import { loadWorldedPreviews } from './worlded-preview';
import { readWorldedWorld } from './worlded-world';

describe('WorldEd terrain previews', () => {
  const world = readWorldedWorld('<world width="1" height="1"><bmp path="ground.png" x="0" y="0" width="1" height="1"/></world>');
  const image = async (name: string, width: number, height: number, color: string): Promise<File> => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    return new File([blob], name, { type: 'image/png' });
  };

  it('combines the terrain image with red tree-mask pixels', async () => {
    const ground = await image('ground.png', 300, 300, '#91873c');
    const vegetation = await image('ground_veg.png', 300, 300, '#ff0000');
    const result = await loadWorldedPreviews(world, new Map([['ground.png', ground], ['ground_veg.png', vegetation]]));
    try {
      expect(result.warnings).toEqual([]);
      expect(result.images.length).toBe(1);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 300;
      const context = canvas.getContext('2d')!;
      context.drawImage(result.images[0].bitmap, 0, 0);
      expect(Array.from(context.getImageData(100, 100, 1, 1).data)).toEqual([47, 76, 64, 255]);
    } finally {
      result.images.forEach(item => item.bitmap.close());
    }
  });

  it('reports an incompatible image rather than stretching it into the world', async () => {
    const ground = await image('ground.png', 10, 10, '#91873c');
    const result = await loadWorldedPreviews(world, new Map([['ground.png', ground]]));
    expect(result.images.length).toBe(0);
    expect(result.warnings.join(' ')).toContain('expected 300 x 300');
  });

  it('shows the ground while warning when the vegetation image is missing', async () => {
    const ground = await image('ground.png', 300, 300, '#91873c');
    const result = await loadWorldedPreviews(world, new Map([['ground.png', ground]]));
    try {
      expect(result.images.length).toBe(1);
      expect(result.warnings.join(' ')).toContain('Vegetation image unavailable');
    } finally {
      result.images.forEach(item => item.bitmap.close());
    }
  });
});
