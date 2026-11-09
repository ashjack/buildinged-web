import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BuildingSelectionWindowComponent } from './components/admin/building-selection-window/building-selection-window.component';
import { ProjectWorkspaceComponent } from './components/project-workspace/project-workspace.component';
import { EditorComponent } from './components/editor/editor.component';
import { ProjectGuard } from './services/project.guard';
import { EditorGuard } from './services/editor.guard';
import { AdminGuard } from './services/admin.guard';
import { AccountAdminComponent } from './components/account-admin/account-admin.component';
import { WorldViewerGuard } from './services/world-viewer.guard';
import { TileAdminComponent } from './components/tile-admin/tile-admin.component';
import { FurnitureAdminComponent } from './components/furniture-admin/furniture-admin.component';

const routes: Routes = [
  { path: '', component: BuildingSelectionWindowComponent, pathMatch: 'full' },
  { path: 'admin', component: TileAdminComponent, canActivate: [AdminGuard] },
  { path: 'admin/accounts', component: AccountAdminComponent, canActivate: [AdminGuard] },
  { path: 'admin/furniture', component: FurnitureAdminComponent, canActivate: [AdminGuard],
    canDeactivate: [(component: FurnitureAdminComponent) => component.canLeave()] },
  { path: 'projects', redirectTo: '', pathMatch: 'full' },
  { path: 'projects/:projectId', component: ProjectWorkspaceComponent, canActivate: [ProjectGuard] },
  { path: 'projects/:projectId/tasks/:taskId', component: ProjectWorkspaceComponent, canActivate: [ProjectGuard] },
  { path: 'projects/:projectId/variants/:variantId/edit', component: EditorComponent,
    canActivate: [ProjectGuard, EditorGuard], canDeactivate: [EditorGuard] },
  { path: 'projects/:projectId/world-buildings/:buildingPath/edit', component: EditorComponent,
    canActivate: [ProjectGuard, AdminGuard, EditorGuard], canDeactivate: [EditorGuard] },
  { path: 'editor', component: EditorComponent, canDeactivate: [EditorGuard] },
  { path: 'tilezed', canMatch: [WorldViewerGuard], loadChildren: () => import('./components/tilezed-viewer/tilezed-viewer.module').then(module => module.TilezedViewerModule) },
  { path: 'worlded', canMatch: [WorldViewerGuard], loadChildren: () => import('./components/worlded-viewer/worlded-viewer.module').then(module => module.WorldedViewerModule) },
  { path: 'settings', loadChildren: () => import('./components/settings/settings.module').then(module => module.SettingsModule) },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
