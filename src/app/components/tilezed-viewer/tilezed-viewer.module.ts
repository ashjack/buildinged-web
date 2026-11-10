import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TilezedViewerComponent } from './tilezed-viewer.component';
import { WorldViewerGuard } from '../../services/world-viewer.guard';
import { TilezedTilePaletteComponent } from './tilezed-tile-palette.component';
import { TilezedBuildingPaletteComponent } from './tilezed-building-palette.component';

@NgModule({
  declarations: [TilezedViewerComponent],
  imports: [CommonModule, TilezedTilePaletteComponent, TilezedBuildingPaletteComponent, RouterModule.forChild([{ path: '', component: TilezedViewerComponent, canActivate: [WorldViewerGuard],
    canDeactivate: [(component: TilezedViewerComponent) => component.canLeave()] }])],
})
export class TilezedViewerModule { }
