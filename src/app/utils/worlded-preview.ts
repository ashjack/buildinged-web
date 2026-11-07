import { worldedFileFor, worldedVegetationPath } from './worlded-files';
import { WorldedBitmap, WorldedWorld } from './worlded-world';

export interface WorldedTerrainImage {
  source: WorldedBitmap;
  bitmap: ImageBitmap;
}

export interface WorldedPreviews {
  images: WorldedTerrainImage[];
  warnings: string[];
}

const MAX_PREVIEW_PIXELS = 4_000_000;
const MAX_PREVIEW_SIDE = 4096;

async function combineTerrain(ground: ImageBitmap, vegetation: ImageBitmap): Promise<ImageBitmap> {
  const scale = Math.min(1, MAX_PREVIEW_SIDE / ground.width, MAX_PREVIEW_SIDE / ground.height,
    Math.sqrt(MAX_PREVIEW_PIXELS / (ground.width * ground.height)));
  const width = Math.max(1, Math.floor(ground.width * scale));
  const height = Math.max(1, Math.floor(ground.height * scale));
  const canvas = document.createElement('canvas');
  const maskCanvas = document.createElement('canvas');
  canvas.width = maskCanvas.width = width;
  canvas.height = maskCanvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!context || !maskContext) throw new Error('The browser could not create a terrain preview.');
  context.imageSmoothingEnabled = false;
  maskContext.imageSmoothingEnabled = false;
  context.drawImage(ground, 0, 0, width, height);
  maskContext.drawImage(vegetation, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const mask = maskContext.getImageData(0, 0, width, height).data;
  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i] === 255 && mask[i + 1] === 0 && mask[i + 2] === 0 && mask[i + 3] === 255) {
      pixels.data[i] = 47;
      pixels.data[i + 1] = 76;
      pixels.data[i + 2] = 64;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return createImageBitmap(canvas);
}

export async function loadWorldedPreviews(world: WorldedWorld, files: ReadonlyMap<string, File>): Promise<WorldedPreviews> {
  const images: WorldedTerrainImage[] = [];
  const warnings: string[] = [];
  if (!world.bitmaps.length) warnings.push('This world does not reference a terrain image; the overview shows the grid and building footprints.');
  for (const source of world.bitmaps) {
    const file = worldedFileFor(files, source.path);
    if (!file) {
      warnings.push(`Terrain image unavailable: ${source.path}. Select the project folder to load it.`);
      continue;
    }
    let ground: ImageBitmap | undefined;
    let vegetation: ImageBitmap | undefined;
    try {
      ground = await createImageBitmap(file);
      if (ground.width !== source.width * world.cellSize || ground.height !== source.height * world.cellSize) {
        throw new Error(`expected ${source.width * world.cellSize} x ${source.height * world.cellSize} pixels, ` +
          `got ${ground.width} x ${ground.height}`);
      }
      const vegetationPath = worldedVegetationPath(source.path);
      const vegetationFile = worldedFileFor(files, vegetationPath);
      if (!vegetationFile) {
        warnings.push(`Vegetation image unavailable: ${vegetationPath}. The ground image is shown without its tree overlay.`);
      } else {
        try {
          vegetation = await createImageBitmap(vegetationFile);
          if (vegetation.width !== ground.width || vegetation.height !== ground.height) {
            throw new Error('its dimensions do not match the terrain image');
          }
          const combined = await combineTerrain(ground, vegetation);
          ground.close();
          ground = combined;
        } catch (error) {
          warnings.push(`Could not apply vegetation image ${vegetationPath}: ${error instanceof Error ? error.message : String(error)}.`);
        }
      }
      images.push({ source, bitmap: ground });
      ground = undefined;
    } catch (error) {
      warnings.push(`Could not load terrain image ${source.path}: ${error instanceof Error ? error.message : String(error)}.`);
    } finally {
      ground?.close();
      vegetation?.close();
    }
  }
  return { images, warnings };
}
