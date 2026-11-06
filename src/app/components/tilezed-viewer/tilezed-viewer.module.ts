import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TilezedViewerComponent } from './tilezed-viewer.component';

@NgModule({
  declarations: [TilezedViewerComponent],
  imports: [CommonModule, RouterModule.forChild([{ path: '', component: TilezedViewerComponent }])],
})
export class TilezedViewerModule { }
