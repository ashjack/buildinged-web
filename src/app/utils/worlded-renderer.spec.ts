import { drawWorldedOverview, worldedBounds, worldedCellAt, worldedProject } from './worlded-renderer';
import { readWorldedWorld } from './worlded-world';

describe('WorldEd overview geometry', () => {
  const world = readWorldedWorld('<world width="2" height="1"><cell x="1" y="0"/></world>');

  it('projects cells isometrically and picks the correct cell at different camera positions', () => {
    expect(worldedBounds(world)).toEqual({ left: 0, top: 0, right: 768, bottom: 384 });
    const viewport = { width: 500, height: 300 };
    const camera = { x: 400, y: 180, zoom: 1.5 };
    const point = worldedProject(world, 1.5, 0.5);
    const x = viewport.width / 2 + (point.x - camera.x) * camera.zoom;
    const y = viewport.height / 2 + (point.y - camera.y) * camera.zoom;
    expect(worldedCellAt(world, camera, viewport, x, y)).toEqual({ x: 1, y: 0 });
    expect(worldedCellAt(world, camera, viewport, -2000, -2000)).toBeUndefined();
  });

  it('draws terrain images in their world position', async () => {
    const source = document.createElement('canvas');
    source.width = source.height = 1;
    const sourceContext = source.getContext('2d')!;
    sourceContext.fillStyle = '#008000';
    sourceContext.fillRect(0, 0, 1, 1);
    const bitmap = await createImageBitmap(source);
    try {
      const single = readWorldedWorld('<world width="1" height="1"/>');
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 256;
      const context = canvas.getContext('2d')!;
      drawWorldedOverview(context, single, [{
        source: { path: 'image.png', x: 0, y: 0, width: 1, height: 1 }, bitmap,
      }], undefined, { x: 256, y: 128, zoom: 1 }, { width: 512, height: 256 }, 1);
      expect(Array.from(context.getImageData(256, 128, 1, 1).data)).toEqual([0, 128, 0, 255]);
    } finally {
      bitmap.close();
    }
  });
});
