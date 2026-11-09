import { Injectable } from '@angular/core';
import { WorldedLot, WorldedZone } from '../utils/worlded-world';

export interface TilezedBuildingContext {
  projectId?: string;
  lots: WorldedLot[];
  files: Map<string, File>;
  /** Zones from the WorldEd cell; the TMX's own object groups are read from the map itself. */
  zones?: WorldedZone[];
}

@Injectable({ providedIn: 'root' })
export class TilezedHandoffService {
  private pending?: File;
  private buildings?: TilezedBuildingContext;

  send(file: File, buildings?: TilezedBuildingContext): void {
    this.pending = file;
    this.buildings = buildings;
  }

  take(): File | undefined {
    const file = this.pending;
    this.pending = undefined;
    return file;
  }

  takeBuildings(): TilezedBuildingContext | undefined {
    const buildings = this.buildings;
    this.buildings = undefined;
    return buildings;
  }

  clear(file: File): void {
    if (this.pending === file) {
      this.pending = undefined;
      this.buildings = undefined;
    }
  }
}
