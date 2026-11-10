import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { ProjectWorldService } from './project-world.service';
import { TilezedBuildingContext } from './tilezed-handoff.service';
import { worldedFileFor, worldedReferenceKey } from '../utils/worlded-files';
import { readWorldedWorld, worldedCellKey } from '../utils/worlded-world';

interface HostedCell { projectId: string; mapPath: string; cell: { x: number; y: number }; }

/** Remember a hosted selection, then reauthorize and load its current saved contents on refresh. */
@Injectable({ providedIn: 'root' })
export class TilezedSessionService {
  constructor(private auth: AuthService, private worlds: ProjectWorldService) { }

  private key(): string | undefined {
    return this.auth.user ? `tilezed:last-cell:${JSON.stringify([this.auth.apiBaseUrl, this.auth.user.uid])}` : undefined;
  }

  remember(context?: TilezedBuildingContext): void {
    const key = this.key();
    if (!key) return;
    if (!context?.projectId) { localStorage.removeItem(key); return; }
    if (!context.mapPath || !context.cell) return;
    localStorage.setItem(key, JSON.stringify({ projectId: context.projectId,
      mapPath: worldedReferenceKey(context.mapPath), cell: { ...context.cell } }));
  }

  async restore(): Promise<{ file: File; buildings: TilezedBuildingContext } | undefined> {
    const key = this.key();
    const saved = key && localStorage.getItem(key);
    if (!saved) return undefined;
    const selection = JSON.parse(saved) as HostedCell;
    if (!selection || typeof selection.projectId !== 'string' || !selection.projectId || typeof selection.mapPath !== 'string'
      || !/\.tmx$/i.test(selection.mapPath) || worldedReferenceKey(selection.mapPath) !== selection.mapPath
      || !selection.cell || ![selection.cell.x, selection.cell.y].every(value => Number.isSafeInteger(value) && value >= 0))
      throw new Error('The last project cell reference is invalid. Reopen the cell from WorldEd.');
    const check = () => { if (this.key() !== key) throw new Error('Your account changed. Reopen the cell from WorldEd.'); };
    const world = await this.worlds.world(selection.projectId);
    check();
    if (!world) throw new Error('The last project world is no longer available.');
    const cell = readWorldedWorld(world.xml).cells.get(worldedCellKey(selection.cell.x, selection.cell.y));
    if (!cell || worldedReferenceKey(cell.map) !== selection.mapPath)
      throw new Error('The last cell map changed. Reopen the cell from WorldEd.');
    const files = await this.worlds.resources(world, () => {});
    check();
    const file = worldedFileFor(files, selection.mapPath);
    if (!file) throw new Error('The last cell map is no longer in the project world.');
    return { file, buildings: { projectId: selection.projectId, mapPath: selection.mapPath,
      worldRevision: world.revision, cell: { ...selection.cell }, files, lots: cell.lots, zones: cell.zones } };
  }
}
