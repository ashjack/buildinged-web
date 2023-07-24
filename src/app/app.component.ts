import { Component } from '@angular/core';
import { PanZoomAPI, PanZoomConfig, PanZoomModel } from 'ngx-panzoom';
import { Subscription } from 'rxjs/internal/Subscription';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'buildinged-web';

  panZoomConfig: PanZoomConfig = new PanZoomConfig();
  isPanning: boolean = false;
  constructor() {
    this.panZoomConfig.dragMouseButton = 'middle';
    this.panZoomConfig.freeMouseWheel = false;
    this.panZoomConfig.invertMouseWheel = true;
  }

  private panZoomAPI: PanZoomAPI;
  private modelChangedSubscription: Subscription;

  ngOnInit(): void {
    this.modelChangedSubscription = this.panZoomConfig.modelChanged.subscribe( (model: PanZoomModel) => this.onModelChanged(model) );
  }

  ngOnDestroy(): void {
    this.modelChangedSubscription.unsubscribe();  // don't forget to unsubscribe.  you don't want a memory leak!
  }

  onModelChanged(model: PanZoomModel): void {
    if(model.isPanning)
    {
      this.isPanning = true;
    }
    else
    {
      this.isPanning = false;
    }
  }
}
