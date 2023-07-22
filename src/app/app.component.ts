import { Component } from '@angular/core';
import { PanZoomConfig } from 'ngx-panzoom';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'buildinged-web';

  panZoomConfig: PanZoomConfig = new PanZoomConfig();
  constructor() {
    this.panZoomConfig.dragMouseButton = 'middle';
    this.panZoomConfig.freeMouseWheel = false;
    this.panZoomConfig.invertMouseWheel = true;
  }
}
