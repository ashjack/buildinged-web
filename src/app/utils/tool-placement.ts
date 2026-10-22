import { Store } from '@ngrx/store';
import { take } from 'rxjs';
import { RemoveObjects } from '../app.actions';
import * as fromRoot from '../app.reducers';
import { Building, TileArea } from '../models/app.models';
import { GridService } from '../services/grid.service';
import { gridContains } from './tbx-grid';

export function tileAreaBetween(x: number, y: number, endX: number, endY: number): TileArea {
    return { x: Math.min(x, endX), y: Math.min(y, endY), width: Math.abs(endX - x) + 1, height: Math.abs(endY - y) + 1 };
}

export function wallEdgePlacement(x: number, y: number, edge: string): { x: number; y: number; dir: 'N' | 'W' } | undefined {
    if (!['N', 'W', 'S', 'E'].includes(edge)) return undefined;
    return { x: x + (edge === 'E' ? 1 : 0), y: y + (edge === 'S' ? 1 : 0), dir: edge === 'E' || edge === 'W' ? 'W' : 'N' };
}

export function canPlaceObject(building: Building | undefined, x: number, y: number, level: number, width = 1, height = 1): boolean {
    return !!building?.floors[level] && gridContains(building.width + 1, building.height + 1, x, y)
        && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
        && x + width <= building.width + 1 && y + height <= building.height + 1;
}

/** Hit testing uses projections; only matching document UIDs on this floor are edited. */
export function eraseProjectedObjects(store: Store<fromRoot.State>, grid: GridService, area: TileArea, level: number, type: string): void {
    store.select(fromRoot.getBuilding).pipe(take(1)).subscribe(building => {
        const candidates = new Set(building?.floors[level]?.objects.filter(object => object.type === type).map(object => object.uid));
        const inside = (x: number, y: number) => x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height;
        const uids = grid.objects.filter(object => object.level === level && candidates.has(object.uid)
            && (object.tiles.length ? object.tiles.some(tile => inside(tile.x, tile.y)) : inside(object.x, object.y))).map(object => object.uid);
        if (uids.length) store.dispatch(new RemoveObjects(uids));
    });
}
