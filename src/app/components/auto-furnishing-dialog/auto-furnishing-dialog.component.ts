import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import * as fromRoot from '../../app.reducers';
import { FurnishingPlacement, PhysicalRoom } from '../../models/auto-furnishing.models';
import { AutoFurnishingService, FurnishingPreview, FurnishingSession } from '../../services/auto-furnishing.service';
import { DbService } from '../../services/db.service';
import { GridService } from '../../services/grid.service';
import { furnishingRoomReason, FurnishingStyle, FURNISHING_STYLES } from '../../utils/furnishing-recipes';

@Component({
    selector: 'app-auto-furnishing-dialog',
    templateUrl: './auto-furnishing-dialog.component.html',
    styleUrls: ['./auto-furnishing-dialog.component.scss']
})
export class AutoFurnishingDialogComponent implements OnDestroy {
    @ViewChild('dialog') dialog: ElementRef<HTMLDialogElement>;
    session?: FurnishingSession;
    preview?: FurnishingPreview;
    selected = new Set<string>();
    activeRoomId = '';
    seed = '1';
    readonly styles = FURNISHING_STYLES;
    style: FurnishingStyle = 'basic-residential';
    generation = 0;
    allowPartial = false;
    busy = false;
    error = '';
    thumbnails: Record<string, string> = {};
    private operation?: AbortController;
    private subscription: Subscription;
    constructor(private furnishing: AutoFurnishingService, private grid: GridService, private db: DbService, store: Store<fromRoot.State>) {
        this.subscription = store.select(fromRoot.getDocumentProjection).subscribe(current => {
            if (this.session && (current.building !== this.session.building || current.documentId !== this.session.documentId)) {
                this.operation?.abort(); this.preview = undefined;
                this.error = 'The building changed. Refresh the room list to continue.';
            }
        });
    }
    get rooms(): PhysicalRoom[] { return this.session?.preparation.analysis.rooms || []; }
    get room(): PhysicalRoom | undefined { return this.rooms.find(room => room.id === this.activeRoomId); }
    get plan() { return this.preview?.plans.find(plan => plan.roomId === this.activeRoomId); }
    get count(): number { return this.preview?.plans.reduce((sum, plan) => sum + plan.placements.length, 0) || 0; }
    get incomplete(): boolean { return !!this.preview?.plans.some(plan => plan.status !== 'complete'); }
    get viewBox(): string {
        const b = this.room?.bounds;
        return b ? `${b.x * 36 - 6} ${b.y * 36 - 6} ${b.width * 36 + 12} ${b.height * 36 + 12}` : '0 0 100 100';
    }
    reason(room: PhysicalRoom): string | undefined { return this.session && furnishingRoomReason(this.session.preparation, room); }
    status(room: PhysicalRoom): string {
        const plan = this.preview?.plans.find(plan => plan.roomId === room.id);
        return this.reason(room) || (plan ? `${plan.status}: ${plan.placements.length} objects` : 'Empty; ready');
    }
    label(placement: FurnishingPlacement): string {
        return this.session?.preparation.catalog.items.find(item => item.id === placement.catalogId)?.label || placement.catalogId;
    }
    color(index: number): string { return `hsl(${(index * 67 + 200) % 360}, 55%, 76%)`; }
    async open(): Promise<void> {
        this.dialog.nativeElement.showModal(); await this.refresh();
    }
    close(): void {
        this.operation?.abort(); this.operation = undefined; this.busy = false;
        this.dialog.nativeElement.close(); this.preview = undefined; this.session = undefined;
    }
    ngOnDestroy(): void { this.operation?.abort(); this.subscription.unsubscribe(); }
    private async run(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
        this.operation?.abort(); const operation = new AbortController(); this.operation = operation;
        this.busy = true; this.error = '';
        try { await task(operation.signal); }
        catch (error) { if (!operation.signal.aborted) this.error = error instanceof Error ? error.message : String(error); }
        finally { if (this.operation === operation) { this.operation = undefined; this.busy = false; } }
    }
    async refresh(): Promise<void> {
        this.preview = undefined; this.session = undefined; this.selected.clear(); this.allowPartial = false;
        await this.run(async signal => {
            const session = await this.furnishing.inspect(); if (signal.aborted) return;
            this.session = session;
            this.rooms.filter(room => room.level === this.grid.getSelectedLevel() && !this.reason(room)).forEach(room => this.selected.add(room.id));
            this.activeRoomId = [...this.selected][0] || this.rooms[0]?.id || '';
        });
    }
    invalidate(): void { this.preview = undefined; this.allowPartial = false; this.generation = 0; }
    toggleRoom(room: PhysicalRoom): void {
        if (this.busy || this.reason(room)) return;
        this.selected.has(room.id) ? this.selected.delete(room.id) : this.selected.add(room.id); this.invalidate();
    }
    async generate(regenerate = false): Promise<void> {
        if (!this.session || !this.selected.size || this.busy) return;
        const session = this.session;
        if (regenerate) this.generation++;
        const seed = this.generation ? `${this.seed}:${this.generation}` : this.seed;
        this.preview = undefined; this.allowPartial = false;
        await this.run(async signal => {
            const preview = await this.furnishing.generate(session, [...this.selected], seed, signal, this.style);
            const thumbnails: Record<string, string> = {};
            await Promise.all(preview.plans.flatMap(plan => plan.placements).map(async p => {
                const name = preview.preparation.catalog.items.find(item => item.id === p.catalogId)!.definition.entries.find(entry => entry.orient === p.orient)!.tiles[0].name;
                thumbnails[p.id] = (await this.db.getTile(name + '.png'))?.url || '';
            }));
            if (signal.aborted) return;
            this.thumbnails = thumbnails; this.preview = preview;
            if (!this.selected.has(this.activeRoomId)) this.activeRoomId = preview.roomIds[0];
        });
    }
    async apply(): Promise<void> {
        if (!this.preview || this.busy || !this.count || this.incomplete && !this.allowPartial) return;
        const preview = this.preview;
        await this.run(async signal => {
            await this.furnishing.apply(preview, this.allowPartial, signal);
            this.close();
        });
    }
}
