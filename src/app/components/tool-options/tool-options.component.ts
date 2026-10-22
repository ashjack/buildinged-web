import { Component } from '@angular/core';
import { Store } from '@ngrx/store';
import * as fromRoot from '../../app.reducers';
import { ToolSettingsService } from '../../services/tool-settings.service';

@Component({
    selector: 'app-tool-options',
    template: `
    <aside *ngIf="tool$ | async as tool" aria-label="Tool options">
      <section *ngIf="tool.startsWith('tool-select-')">
        <strong>Select and move {{tool.slice(12)}}</strong>
        <p>Drag a rectangle to select. Drag inside the selection to move. Arrow keys nudge. Delete removes the selection. Escape clears it.</p>
        <p *ngIf="tool === 'tool-select-objects'">Click an object to select it. Shift adds objects; Ctrl removes them from the selection.</p>
        <p *ngIf="tool === 'tool-select-rooms'">Hold Ctrl while moving to affect every floor. Hold Shift to include objects whose origins are selected.</p>
        <p *ngIf="tool === 'tool-select-tiles'">Moves only manual tiles on the selected layer. Generated walls and floors follow their rooms and objects.</p>
      </section>
      <p *ngIf="settings.message && !['tool-wall', 'tool-stairs', 'tool-door', 'tool-window', 'tool-furniture'].includes(tool)" role="status">{{settings.message}}</p>
    </aside>`,
    styles: [`aside { position: absolute; left: 8px; top: 28px; width: 270px; z-index: 5; color: #222; }
      section, [role=status] { background: #eee; border: 1px solid #aaa; padding: 10px; border-radius: 4px; }
      label { display: block; margin-top: 8px; } select { display: block; max-width: 100%; width: 100%; }
      p { margin: 8px 0 0; font-size: 13px; }`]
})
export class ToolOptionsComponent {
    readonly tool$ = this.store.select(fromRoot.getCurrentTool);
    constructor(private store: Store<fromRoot.State>, public settings: ToolSettingsService) { }
}
