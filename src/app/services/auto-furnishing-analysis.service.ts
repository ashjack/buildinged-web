import { Injectable } from '@angular/core';
import { Building } from '../models/app.models';
import { FurnishingCatalog, FurnishingPreparation } from '../models/auto-furnishing.models';
import { buildFurnishingCatalog } from '../utils/furnishing-catalog';
import { analyzeFurnishingRooms } from '../utils/furnishing-room-analysis';
import { DbService } from './db.service';
import { FurnitureLibraryService } from './furniture-library.service';

/** Read-only preparation shared by preview, planning and Apply validation. */
@Injectable({ providedIn: 'root' })
export class AutoFurnishingAnalysisService {
    private catalog?: { text: string; catalog: FurnishingCatalog };
    constructor(private library: FurnitureLibraryService, private db: DbService) { }
    /** Rebuilt whenever the shared furniture list changes, e.g. after an admin edit. */
    async loadCatalog(): Promise<FurnishingCatalog> {
        const { text } = await this.library.load();
        if (this.catalog?.text !== text) this.catalog = { text, catalog: buildFurnishingCatalog(text) };
        return this.catalog.catalog;
    }
    async prepare(building: Building): Promise<FurnishingPreparation> {
        const catalog = await this.loadCatalog();
        // Check downloaded sprites on every preparation: a tilepack may have changed since the previous call.
        const names = [...new Set(catalog.items.flatMap(item => item.requiredTiles))];
        const tiles = await Promise.all(names.map(async name => [name, await this.db.hasTile(name)] as const));
        const available = new Map(tiles);
        const availability = catalog.items.flatMap(item => item.variants.map(variant => {
            const definition = item.definition.entries.find(entry => entry.orient === variant.orient)!;
            const missingTiles = [...new Set(definition.tiles.map(tile => tile.name + '.png'))].filter(name => !available.get(name)).sort();
            return { catalogId: item.id, orient: variant.orient, available: !missingTiles.length, missingTiles };
        }));
        const analysis = analyzeFurnishingRooms(building, catalog);
        analysis.diagnostics.push(...catalog.diagnostics);
        for (const item of catalog.items) {
            if (availability.some(variant => variant.catalogId === item.id && variant.available)) continue;
            analysis.diagnostics.push({ code: 'catalog-assets-missing', catalogId: item.id, message: `${item.label} has no orientation with all required sprites downloaded.` });
        }
        return { analysis, catalog, availability };
    }
}
