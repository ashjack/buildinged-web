import { Component } from '@angular/core';
import * as fromRoot from '../app.reducers';
import { Store } from '@ngrx/store';
import { SetCurrentTool } from '../app.actions';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.scss']
})
export class MenuComponent {
  constructor(
    private store: Store<fromRoot.State>
  ) { }

  setTool(tool: string)
  {
    this.store.dispatch(new SetCurrentTool(tool));
  }
}
