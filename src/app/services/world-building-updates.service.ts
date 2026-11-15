import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { worldedReferenceKey } from '../utils/worlded-files';

export const WORLD_BUILDING_SAVED_KEY = 'buildinged:world-building-saved:v1';
export interface WorldBuildingSaved {
    id: string; userId: string; apiBaseUrl: string;
    projectId: string; path: string; previousRevision: number; revision: number;
}

/** Only save metadata crosses tabs; viewers fetch the committed document using their own account. */
@Injectable({ providedIn: 'root' })
export class WorldBuildingUpdatesService implements OnDestroy {
    private readonly changes = new Subject<WorldBuildingSaved>();
    readonly changes$ = this.changes.asObservable();
    private channel?: BroadcastChannel;
    private readonly received = new Set<string>();
    private readonly storageChanged = (event: StorageEvent) => {
        if (event.key === WORLD_BUILDING_SAVED_KEY && event.newValue) this.read(event.newValue);
    };
    private readonly focused = () => {
        try { const saved = localStorage.getItem(WORLD_BUILDING_SAVED_KEY); if (saved) this.read(saved); } catch { /* BroadcastChannel remains available. */ }
    };

    constructor(private auth: AuthService, private zone: NgZone) {
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.channel = new BroadcastChannel(WORLD_BUILDING_SAVED_KEY);
                this.channel.onmessage = event => this.receive(event.data);
            }
        } catch { /* Storage events also deliver updates across tabs. */ }
        window.addEventListener('storage', this.storageChanged);
        window.addEventListener('focus', this.focused);
    }

    publish(building: { projectId: string; path: string; revision: number }, previousRevision: number): void {
        const event: WorldBuildingSaved = { id: crypto.randomUUID(), userId: this.auth.user?.uid || '',
            apiBaseUrl: this.auth.apiBaseUrl, projectId: building.projectId, path: building.path, revision: building.revision, previousRevision };
        if (!this.valid(event)) return;
        this.receive(event);
        try { this.channel?.postMessage(event); } catch { /* Fall back to storage events. */ }
        try { localStorage.setItem(WORLD_BUILDING_SAVED_KEY, JSON.stringify(event)); } catch { /* A saved cloud building must not fail because storage is full. */ }
    }

    private read(value: string): void { try { this.receive(JSON.parse(value)); } catch { /* Ignore unrelated or malformed browser data. */ } }
    private valid(value: unknown): value is WorldBuildingSaved {
        if (!value || typeof value !== 'object') return false;
        const e = value as WorldBuildingSaved;
        return typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 100 &&
            typeof e.userId === 'string' && !!e.userId && e.userId === this.auth.user?.uid &&
            typeof e.apiBaseUrl === 'string' && e.apiBaseUrl === this.auth.apiBaseUrl &&
            typeof e.projectId === 'string' && !!e.projectId && e.projectId.length <= 200 &&
            typeof e.path === 'string' && e.path.length <= 1000 && /\.tbx$/i.test(e.path) && worldedReferenceKey(e.path) === e.path &&
            Number.isSafeInteger(e.previousRevision) && e.previousRevision >= 0 && Number.isSafeInteger(e.revision) && e.revision > e.previousRevision;
    }
    private receive(value: unknown): void {
        if (!this.valid(value) || this.received.has(value.id)) return;
        this.received.add(value.id);
        if (this.received.size > 128) this.received.delete(this.received.values().next().value!);
        this.zone.run(() => this.changes.next(value));
    }
    ngOnDestroy(): void {
        this.channel?.close();
        window.removeEventListener('storage', this.storageChanged);
        window.removeEventListener('focus', this.focused);
        this.changes.complete();
    }
}
