import { Injectable } from "@angular/core";

/** Decoded tile images for canvas drawing, keyed by tile name. */
@Injectable({
    providedIn: 'root',
})
export class CacheService {
    private cache = new Map<string, CanvasImageSource>();

    get(key: string): CanvasImageSource | null {
        return this.cache.get(key) ?? null;
    }

    set(key: string, value: CanvasImageSource): void {
        this.cache.set(key, value);
    }

    contains(key: string): boolean {
        return this.cache.has(key);
    }

    keys(): string[] {
        return [...this.cache.keys()];
    }

    delete(key: string): void {
        const image = this.cache.get(key);
        this.cache.delete(key);
        if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
    }

    clear(): void {
        this.keys().forEach(key => this.delete(key));
    }
}
