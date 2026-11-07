import { Injectable } from '@angular/core';
import { WorldedLot } from '../utils/worlded-world';

export interface TilezedBuildingContext {
  lots: WorldedLot[];
  files: Map<string, File>;
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
