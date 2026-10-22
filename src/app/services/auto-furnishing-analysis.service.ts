import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Building } from '../models/app.models';
import { FurnishingCatalog, FurnishingPreparation } from '../models/auto-furnishing.models';
import { buildFurnishingCatalog } from '../utils/furnishing-catalog';
import { analyzeFurnishingRooms } from '../utils/furnishing-room-analysis';
import { DbService } from './db.service';

/** Read-only preparation shared by preview, planning and Apply validation. */
@Injectable({ providedIn: 'root' })
export class AutoFurnishingAnalysisService {
    private catalog?: Promise<FurnishingCatalog>;
    constructor(private http: HttpClient, private db: DbService) { }
    loadCatalog(): Promise<FurnishingCatalog> {
        if (!this.catalog) this.catalog = firstValueFrom(this.http.get('assets/BuildingFurniture.txt', { responseType: 'text' }))
            .then(buildFurnishingCatalog).catch(error => { this.catalog = undefined; throw error; });
        return this.catalog;
    }
    async prepare(building: Building): Promise<FurnishingPreparation> {
        const catalog = await this.loadCatalog();
        // Check downloaded sprites on every preparation: a tilepack may have changed since the previous call.
        const names = [...new Set(catalog.items.flatMap(item => item.requiredTiles))];
        const tiles = await Promise.all(names.map(async name => [name, !!(await this.db.getTile(name))] as const));
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
