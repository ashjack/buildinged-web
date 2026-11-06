import { Directive, NgZone, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, filter, firstValueFrom } from 'rxjs';

const STALE_MS = 60_000;
const POLL_MS = 5 * 60_000;

export interface PublishedLibrary<T> { text: string; document: T; }

export interface PublishedLibraryConfig<T> {
  /** The admin-published copy in the public bucket. */
  url: string;
  /** Shipped with the app; used until the admin first publishes. */
  bundledUrl: string;
  /** BroadcastChannel name used to push admin saves to other tabs. */
  channel: string;
  description: string;
  parse(text: string): T;
}

/**
 * A text file every part of the app reads, published by an admin page. It re-checks the bucket when the tab
 * regains focus and every few minutes, and admin saves are pushed to other open tabs straight away.
 */
@Directive()
export abstract class PublishedTextLibrary<T> implements OnDestroy {
  private readonly current = new BehaviorSubject<PublishedLibrary<T> | null>(null);
  readonly library$: Observable<PublishedLibrary<T>> = this.current.pipe(filter((value): value is PublishedLibrary<T> => !!value));
  private request?: Promise<PublishedLibrary<T>>;
  private lastFetch = 0;
  private poll?: ReturnType<typeof setInterval>;
  private channel?: BroadcastChannel;
  private readonly onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refresh(); };

  protected constructor(protected http: HttpClient, private config: PublishedLibraryConfig<T>, private zone?: NgZone) { }

  /** The current copy, fetching it on first use. */
  load(): Promise<PublishedLibrary<T>> {
    const value = this.current.value;
    if (value) return Promise.resolve(value);
    this.listen();
    return this.request ??= this.fetch().finally(() => this.request = undefined);
  }

  /** Re-reads the published file if the last check is older than a minute (or always, when forced). */
  async refresh(force = false): Promise<PublishedLibrary<T>> {
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
    return firstValueFrom(this.http.get(this.config.bundledUrl, { responseType: 'text' }));
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    this.channel?.close();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.onVisible);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
  }

  private async fetch(): Promise<PublishedLibrary<T>> {
    this.lastFetch = Date.now();
    let text: string | null = null;
    try {
      text = await firstValueFrom(this.http.get(this.config.url, { responseType: 'text', headers: { 'Cache-Control': 'no-cache' } }));
      this.config.parse(text);
    } catch (error) {
      if (text !== null) console.warn(`The published ${this.config.description} could not be read; using the bundled copy.`, error);
      text = null;
    }
    if (text === null) text = await this.bundledText();
    return this.apply(text);
  }

  private apply(text: string): PublishedLibrary<T> {
    const value = this.current.value;
    if (value?.text === text) return value;
    const library = { text, document: this.config.parse(text) };
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
      this.channel = new BroadcastChannel(this.config.channel);
      this.channel.onmessage = event => {
        if (typeof event.data?.text !== 'string') return;
        try { this.apply(event.data.text); } catch { void this.refresh(true); }
      };
    }
  }
}
