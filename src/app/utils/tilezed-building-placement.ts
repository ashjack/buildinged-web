import { WorldedLot } from './worlded-world';
import { TilePoint } from './tilezed-edit';

/** WorldEd's DnDItem uses the centre tile as its hotspot and snaps to the nearest grid intersection. */
export function tilezedBuildingPlacement(building: { path: string; width: number; height: number }, cursor: TilePoint): WorldedLot {
  return { map: building.path, width: building.width, height: building.height, level: 0,
    x: Math.round(cursor.x) - Math.floor(building.width / 2), y: Math.round(cursor.y) - Math.floor(building.height / 2) };
}
