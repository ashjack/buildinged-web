import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { WorldedCellPanelComponent } from './worlded-cell-panel.component';
import { WorldedViewerComponent } from './worlded-viewer.component';
import { ProjectWorldComponent } from './project-world.component';
import { WorldViewerGuard } from '../../services/world-viewer.guard';
import { WorldedProjectsComponent } from './worlded-projects.component';

@NgModule({
  declarations: [WorldedViewerComponent, WorldedCellPanelComponent, ProjectWorldComponent, WorldedProjectsComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild([
    { path: 'project/:projectId', component: ProjectWorldComponent, canActivate: [WorldViewerGuard],
      canDeactivate: [(component: ProjectWorldComponent) => component.canLeave()] },
    { path: '', component: WorldedProjectsComponent, pathMatch: 'full', canActivate: [WorldViewerGuard] },
  ])],
})
export class WorldedViewerModule { }
