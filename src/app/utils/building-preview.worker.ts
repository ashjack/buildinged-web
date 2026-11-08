import { Building } from '../models/app.models';
import { buildingPixelBounds, buildingPreviewTiles, buildingSquareBounds, prepareBuildingTiles } from './building-preview';

addEventListener('message', ({ data }: MessageEvent<{ id: number; building: Building; firstLevel: number }>) => {
  try {
    const generated = buildingPreviewTiles(data.building);
    const tiles = prepareBuildingTiles(generated, data.firstLevel);
    postMessage({ id: data.id, tiles, bounds: buildingPixelBounds(tiles),
      squares: buildingSquareBounds(generated, data.firstLevel) }, {});
  } catch (error) {
    postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }, {});
  }
});
