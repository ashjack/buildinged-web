import { Injectable, OnDestroy } from '@angular/core';
import { Store } from '@ngrx/store';
import { BehaviorSubject, Subscription } from 'rxjs';
import * as fromRoot from '../app.reducers';
import { SetCurrentTool } from '../app.actions';

export type EditorMode = 'ortho' | 'iso' | 'tile';
const isTileTool = (tool: string) => ['tool-tile', 'tool-select-tiles'].includes(tool);

/** The object views share tools; Tile keeps its own last selected tool. */
@Injectable({ providedIn: 'root' })
export class EditorViewService implements OnDestroy {
    private readonly modeChanges = new BehaviorSubject<EditorMode>('iso');
    readonly mode$ = this.modeChanges.asObservable();
    get mode(): EditorMode { return this.modeChanges.value; }
    private objectMode: 'ortho' | 'iso' = 'iso';
    private objectTool = 'tool-draw-room';
    private tileTool = 'tool-tile';
    private readonly subscription: Subscription;

    constructor(private store: Store<fromRoot.State>) {
        this.subscription = store.select(fromRoot.getCurrentTool).subscribe(tool => {
            if (isTileTool(tool)) {
                this.tileTool = tool;
                if (this.mode !== 'tile') this.modeChanges.next('tile');
            } else {
                this.objectTool = tool;
                if (this.mode === 'tile') this.modeChanges.next(this.objectMode);
            }
        });
    }

    setMode(mode: EditorMode): void {
        if (mode === this.mode) return;
        if (mode !== 'tile') this.objectMode = mode;
        this.modeChanges.next(mode);
        this.store.dispatch(new SetCurrentTool(mode === 'tile' ? this.tileTool : this.objectTool));
    }

    ngOnDestroy(): void { this.subscription.unsubscribe(); this.modeChanges.complete(); }
}
