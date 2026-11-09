import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TilezedViewerComponent } from './tilezed-viewer.component';
import { WorldViewerGuard } from '../../services/world-viewer.guard';

@NgModule({
  declarations: [TilezedViewerComponent],
  imports: [CommonModule, RouterModule.forChild([{ path: '', component: TilezedViewerComponent, canActivate: [WorldViewerGuard] }])],
})
export class TilezedViewerModule { }
