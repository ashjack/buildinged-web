import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { MenuComponent } from './menu/menu.component';
import { ViewportComponent } from './viewport/viewport.component';
import { NgxPanZoomModule } from 'ngx-panzoom';
import { HttpClientModule } from '@angular/common/http';
import { TileSelectionMenuComponent } from './tile-selection-menu/tile-selection-menu.component';
import { Store, StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { reducer } from './app.reducers';
import { ViewportCanvasComponent } from './viewport-canvas/viewport-canvas.component';

@NgModule({
  declarations: [
    AppComponent,
    MenuComponent,
    ViewportComponent,
    ViewportCanvasComponent,
    TileSelectionMenuComponent,
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
