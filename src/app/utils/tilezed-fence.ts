import { TilePoint } from './tilezed-edit';

export interface FenceCell { point: TilePoint; gid: number; }
export type FenceTiles = ReadonlyMap<string, number>;

/** Native FenceTool: dominant-axis drag, directional alternation, NW joins, Alt gates, Ctrl posts. */
export function tilezedFenceCells(tiles: FenceTiles, start: TilePoint, end: TilePoint | undefined,
  current: (point: TilePoint) => number, modifiers: { alt: boolean; ctrl: boolean }): FenceCell[] {
  const origin = { x: Math.floor(start.x), y: Math.floor(start.y) };
  const cells: FenceCell[] = [];
  const put = (point: TilePoint, gid: number | undefined) => { if (gid !== undefined) cells.push({ point, gid }); };
  const matches = (gid: number, ...roles: string[]) => roles.some(role => !!tiles.get(role) && gid === tiles.get(role));
  const join = (point: TilePoint, north: boolean, alternate: number) => {
    const existing = current(point), direction = north ? 'north' : 'west', opposite = north ? 'west' : 'north';
    // Native stamps leave existing corner cells empty so PaintTileLayer preserves them.
    // Apply that preservation to completed sections and special pieces too; a new
    // perpendicular edge only needs to replace its intersection with a joined tile.
    if (matches(existing, 'nw', 'post', 'gate-space-w', 'gate-space-n', 'gate-door-w', 'gate-door-n')) return;
    if (matches(existing, `${opposite}1`, `${opposite}2`)) put(point, tiles.get('nw'));
    else if (!matches(existing, `${direction}1`, `${direction}2`)) put(point, tiles.get(`${direction}${alternate + 1}`));
  };
  if (!end && modifiers.ctrl) {
    const post = tiles.get('post');
    if (post) put(origin, current(origin) === post ? 0 : post);
    return cells;
  }
  const fractionX = start.x - origin.x, fractionY = start.y - origin.y;
  const westEdge = fractionX < 1 - fractionX && fractionX < fractionY && fractionX < 1 - fractionY;
  const eastEdge = 1 - fractionX <= fractionX && 1 - fractionX < fractionY && 1 - fractionX < 1 - fractionY;
  const southEdge = !westEdge && !eastEdge && 1 - fractionY <= fractionY;
  const west = westEdge || southEdge;
  if (!end && modifiers.alt) {
    const existing = current(origin);
    const is = (...roles: string[]) => matches(existing, ...roles);
    put(origin, is('west1', 'west2') ? tiles.get('gate-space-w') : is('north1', 'north2') ? tiles.get('gate-space-n') : tiles.get(west ? 'gate-door-w' : 'gate-door-n'));
    return cells;
  }
  if (!end) {
    join(origin, !west, 0);
    return cells;
  }
  const north = Math.abs(end.x - start.x) > Math.abs(end.y - start.y);
  const from = north ? origin.x : origin.y, to = Math.floor(north ? end.x : end.y), step = from > to ? -1 : 1;
  let alternate = step < 0 ? 1 : 0;
  for (let value = from; step > 0 ? value <= to : value >= to; value += step) {
    const point = north ? { x: value, y: origin.y } : { x: origin.x, y: value };
    join(point, north, alternate);
    alternate = 1 - alternate;
  }
  return cells;
}
