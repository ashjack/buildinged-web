import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { MenuComponent } from './menu/menu.component';
import { ViewportComponent } from './viewport/viewport.component';
import { IsometricCanvasComponent } from './isometric-canvas/isometric-canvas.component';
import { NgxPanZoomModule } from 'ngx-panzoom';
import { HttpClientModule } from '@angular/common/http';
import { TileSelectionMenuComponent } from './tile-selection-menu/tile-selection-menu.component';
import { IsometricCanvasDomComponent } from './isometric-canvas-dom/isometric-canvas-dom.component';
import { Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { reducer } from './app.reducers';

@NgModule({
  declarations: [
    AppComponent,
    MenuComponent,
    ViewportComponent,
    IsometricCanvasComponent,
    TileSelectionMenuComponent,
    IsometricCanvasDomComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    NgxPanZoomModule,
    HttpClientModule,
    StoreModule.forRoot({}),
    StoreModule.forFeature('root', reducer),
    EffectsModule.forRoot([]),
    //StoreModule.forRoot({ reducer: appRed })
  ],
  providers: [],
  bootstrap: [AppComponent]
})

export class AppModule { }
