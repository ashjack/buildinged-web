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
    HttpClientModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
