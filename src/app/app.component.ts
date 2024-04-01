import { Component } from '@angular/core';
import { PanZoomAPI, PanZoomConfig, PanZoomModel } from 'ngx-panzoom';
import { Subscription } from 'rxjs/internal/Subscription';
import * as fromRoot from './app.reducers';
import { Store } from "@ngrx/store";
import { Observable } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'buildinged-web';

  panZoomConfig: PanZoomConfig = new PanZoomConfig();
  isPanning: boolean = false;
  selectedTool$: Observable<string>;

  constructor(private store: Store<fromRoot.State>) {
    this.panZoomConfig.dragMouseButton = 'middle';
    this.panZoomConfig.freeMouseWheel = false;
    this.panZoomConfig.invertMouseWheel = true;

    this.selectedTool$ = store.select(fromRoot.getCurrentTool);
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
