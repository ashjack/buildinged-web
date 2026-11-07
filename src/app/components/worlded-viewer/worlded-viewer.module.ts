import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { WorldedCellPanelComponent } from './worlded-cell-panel.component';
import { WorldedViewerComponent } from './worlded-viewer.component';

@NgModule({
  declarations: [WorldedViewerComponent, WorldedCellPanelComponent],
  imports: [CommonModule, RouterModule.forChild([{ path: '', component: WorldedViewerComponent }])],
})
export class WorldedViewerModule { }
