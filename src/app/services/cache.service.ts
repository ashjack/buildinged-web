import { Injectable } from "@angular/core";

@Injectable({
    providedIn: 'root',
})
export class CacheService {
    private cache: Map<string, HTMLImageElement>;

    constructor() { 
        this.cache = new Map<string, HTMLImageElement>();
    }

    get(key: string): HTMLImageElement | null {
        return this.cache.get(key) ?? null;
    }

    set(key: string, value: HTMLImageElement): void {
        this.cache.set(key, value);
    }

    contains(key: string): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }
}