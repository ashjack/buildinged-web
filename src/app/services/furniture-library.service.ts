import { Injectable, NgZone, OnDestroy, Optional } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, filter, firstValueFrom, map } from 'rxjs';
import { BFurnitureGroup, FurnitureDocument } from '../models/furniture-window.models';
import { parseFurnitureDocument } from '../utils/furniture-catalog-parser';

/** Published by the admin furniture editor. Until the first save, the bundled copy is used. */
export const FURNITURE_URL = 'https://storage.googleapis.com/buildinged-online.appspot.com/BuildingFurniture.txt';
export const BUNDLED_FURNITURE_URL = 'assets/BuildingFurniture.txt';
const CHANNEL = 'buildinged-furniture';
const STALE_MS = 60_000;
const POLL_MS = 5 * 60_000;

export interface FurnitureLibrary { text: string; document: FurnitureDocument; }

/**
 * The one furniture list every part of the app reads. It re-checks the bucket when the tab regains focus and
 * every few minutes, and admin saves are pushed to other open tabs straight away.
 */
@Injectable({ providedIn: 'root' })
export class FurnitureLibraryService implements OnDestroy {
  private readonly current = new BehaviorSubject<FurnitureLibrary | null>(null);
  readonly library$: Observable<FurnitureLibrary> = this.current.pipe(filter((value): value is FurnitureLibrary => !!value));
  readonly groups$: Observable<BFurnitureGroup[]> = this.library$.pipe(map(library => library.document.groups));
  private request?: Promise<FurnitureLibrary>;
  private lastFetch = 0;
  private poll?: ReturnType<typeof setInterval>;
  private channel?: BroadcastChannel;
  private readonly onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refresh(); };

  constructor(private http: HttpClient, @Optional() private zone?: NgZone) { }

  /** The current list, fetching it on first use. */
  load(): Promise<FurnitureLibrary> {
    const value = this.current.value;
    if (value) return Promise.resolve(value);
    this.listen();
    return this.request ??= this.fetch().finally(() => this.request = undefined);
  }

  /** Re-reads the published list if the last check is older than a minute (or always, when forced). */
  async refresh(force = false): Promise<FurnitureLibrary> {
    if (!this.current.value) return this.load();
    if (this.request) return this.request;
    if (!force && Date.now() - this.lastFetch < STALE_MS) return this.current.value;
    return this.request = this.fetch().finally(() => this.request = undefined);
  }

  /** Called after an admin save: reloads the published file here and tells other tabs to do the same. */
  async published(): Promise<void> {
    const library = await this.refresh(true);
    this.channel?.postMessage({ text: library.text });
  }

  /** The copy shipped with the app, used to seed the published file. */
  bundledText(): Promise<string> {
    return firstValueFrom(this.http.get(BUNDLED_FURNITURE_URL, { responseType: 'text' }));
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    this.channel?.close();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.onVisible);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
  }

  private async fetch(): Promise<FurnitureLibrary> {
    this.lastFetch = Date.now();
    let text: string | null = null;
    try {
      text = await firstValueFrom(this.http.get(FURNITURE_URL, { responseType: 'text', headers: { 'Cache-Control': 'no-cache' } }));
      parseFurnitureDocument(text);
    } catch (error) {
      if (text !== null) console.warn('The published furniture list could not be read; using the bundled copy.', error);
      text = null;
    }
    if (text === null) text = await this.bundledText();
    return this.apply(text);
  }

  private apply(text: string): FurnitureLibrary {
    const value = this.current.value;
    if (value?.text === text) return value;
    const library = { text, document: parseFurnitureDocument(text) };
    const emit = () => this.current.next(library);
    this.zone ? this.zone.run(emit) : emit();
    return library;
  }

  private listen(): void {
    if (this.poll || typeof window === 'undefined') return;
    window.addEventListener('focus', this.onVisible);
    document.addEventListener('visibilitychange', this.onVisible);
    this.poll = setInterval(() => this.onVisible(), POLL_MS);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = event => {
        if (typeof event.data?.text !== 'string') return;
        try { this.apply(event.data.text); } catch { void this.refresh(true); }
      };
    }
  }
}
