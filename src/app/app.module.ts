import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { MenuComponent } from './menu/menu.component';
import { NgxPanZoomModule } from 'ngx-panzoom';
import { HttpClientModule } from '@angular/common/http';
import { TileSelectionMenuComponent } from './components/tile-selection-menu/tile-selection-menu.component';
import { Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { reducer } from './app.reducers';
import { ViewportCanvasComponent } from './viewport-canvas/viewport-canvas.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { FurnitureSelectionMenuComponent } from './components/furniture-selection-menu/furniture-selection-menu.component';
import { TileDownloadWindowComponent } from './components/tile-download-window/tile-download-window.component';
import { FormsModule } from '@angular/forms';
import { TilesetListWindowComponent } from './components/tileset-list-window/tileset-list-window.component';
import { BuildingSelectionWindowComponent } from './components/admin/building-selection-window/building-selection-window.component';

@NgModule({
  declarations: [
    AppComponent,
    MenuComponent,
    ViewportCanvasComponent,
    TileSelectionMenuComponent,
    FurnitureSelectionMenuComponent,
    TileDownloadWindowComponent,
    TilesetListWindowComponent,
    BuildingSelectionWindowComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    NgxPanZoomModule,
    HttpClientModule,
    FormsModule,
    StoreModule.forRoot({}),
    StoreModule.forFeature('root', reducer),
    EffectsModule.forRoot([]),
    BrowserAnimationsModule,
    BsDropdownModule.forRoot(),
    //StoreModule.forRoot({ reducer: appRed })
  ],
  providers: [],
  bootstrap: [AppComponent]
})

export class AppModule { }
