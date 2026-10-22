import { Component } from '@angular/core';
import { Store } from '@ngrx/store';
import * as fromRoot from '../../app.reducers';
import { BuildingService } from '../../services/building.service';
import { ToolSettingsService } from '../../services/tool-settings.service';

@Component({
    selector: 'app-tool-options',
    template: `
    <aside *ngIf="tool$ | async as tool" aria-label="Tool options">
      <section *ngIf="tool === 'tool-wall'">
        <strong>Walls</strong>
        <label *ngFor="let field of wallFields">{{field.label}}
          <select [(ngModel)]="settings[field.key]" [attr.aria-label]="field.label">
            <option [ngValue]="null">Building / first room default</option>
            <option [ngValue]="0">None (remove this wall face)</option>
            <option *ngFor="let entry of entries(field.category)" [ngValue]="entry.id">{{entry.label}}</option>
          </select>
        </label>
        <p>The green diamond snaps to grid intersections. Drag to draw a wall. Hover an existing wall to reveal its resize handles. Alt-click a wall to pick its materials.</p>
      </section>
      <section *ngIf="tool === 'tool-stairs'">
        <strong>Stairs</strong>
        <label>Stair tiles <select [(ngModel)]="settings.stairs"><option [ngValue]="null">Building default</option><option [ngValue]="0">None</option>
          <option *ngFor="let entry of entries('stairs')" [ngValue]="entry.id">{{entry.label}}</option></select></label>
        <p>Move within a grid square to choose the direction automatically. Left-click places stairs. Right-click removes an object. Alt-click picks existing stairs.</p>
      </section>
      <section *ngIf="tool.startsWith('tool-select-')">
        <strong>Select and move {{tool.slice(12)}}</strong>
        <p>Drag a rectangle to select. Drag inside the selection to move. Arrow keys nudge. Delete removes the selection. Escape clears it.</p>
        <p *ngIf="tool === 'tool-select-objects'">Click an object to select it. Shift adds objects; Ctrl removes them from the selection.</p>
        <p *ngIf="tool === 'tool-select-rooms'">Hold Ctrl while moving to affect every floor. Hold Shift to include objects whose origins are selected.</p>
        <p *ngIf="tool === 'tool-select-tiles'">Moves only manual tiles on the selected layer. Generated walls and floors follow their rooms and objects.</p>
      </section>
      <p *ngIf="settings.message" role="status">{{settings.message}}</p>
    </aside>`,
    styles: [`aside { position: absolute; left: 8px; top: 28px; width: 270px; z-index: 5; color: #222; }
      section, [role=status] { background: #eee; border: 1px solid #aaa; padding: 10px; border-radius: 4px; }
      label { display: block; margin-top: 8px; } select { display: block; max-width: 100%; width: 100%; }
      p { margin: 8px 0 0; font-size: 13px; }`]
})
export class ToolOptionsComponent {
    readonly tool$ = this.store.select(fromRoot.getCurrentTool);
    readonly wallFields: { key: 'exterior' | 'interior' | 'exteriorTrim' | 'interiorTrim'; label: string; category: string }[] = [
        { key: 'exterior', label: 'Exterior wall', category: 'exterior_walls' },
        { key: 'interior', label: 'Interior wall', category: 'interior_walls' },
        { key: 'exteriorTrim', label: 'Exterior trim', category: 'exterior_wall_trim' },
        { key: 'interiorTrim', label: 'Interior trim', category: 'interior_wall_trim' },
    ];
    constructor(private store: Store<fromRoot.State>, private buildings: BuildingService, public settings: ToolSettingsService) { }
    entries(category: string) {
        return (this.buildings.building?.entries || []).map((entry, index) => ({ entry, id: index + 1 }))
            .filter(value => value.entry.category === category)
            .map(value => ({ id: value.id, label: value.entry.tiles.find(t => t.tile)?.tile || 'Empty definition' }));
    }
}
