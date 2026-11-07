import { Building } from '../models/app.models';
import { buildingPixelBounds, buildingPreviewTiles, buildingSquareBounds, prepareBuildingTiles } from './building-preview';

addEventListener('message', ({ data }: MessageEvent<{ building: Building; firstLevel: number }>) => {
  try {
    const generated = buildingPreviewTiles(data.building);
    const tiles = prepareBuildingTiles(generated, data.firstLevel);
    postMessage({ tiles, bounds: buildingPixelBounds(tiles), squares: buildingSquareBounds(generated, data.firstLevel) }, {});
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : String(error) }, {});
  }
});
