import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { WorldedWorld } from '../utils/worlded-world';
import { WorldedSavedProject } from './worlded-storage.service';

export interface WorldedSession extends WorldedSavedProject {
  world: WorldedWorld;
  restored: boolean;
  selectedCell?: { x: number; y: number };
  storageWarning?: string;
}

@Injectable({ providedIn: 'root' })
export class WorldedSessionService {
  current?: WorldedSession;
  private readonly changes = new Subject<WorldedSession>();
  readonly changes$ = this.changes.asObservable();

  notifyChanged(session: WorldedSession): void {
    if (this.current === session) this.changes.next(session);
  }
}
