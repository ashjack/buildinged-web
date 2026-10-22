import { HttpClient, HttpClientModule } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { AutoFurnishingAnalysisService } from '../services/auto-furnishing-analysis.service';
import { buildFurnishingCatalog, FURNISHING_CATALOG_SPECS } from './furnishing-catalog';
import { parseFurnitureGroups } from './furniture-catalog-parser';
import { nativeBuildingXml } from '../testing/native-building.fixture';
import { readBuildingFile } from './tbx-format';

describe('Curated furnishing catalog', () => {
    let source: string;
    beforeAll(async () => {
        TestBed.configureTestingModule({ imports: [HttpClientModule] });
        source = await firstValueFrom(TestBed.inject(HttpClient).get('/assets/BuildingFurniture.txt', { responseType: 'text' }));
    });
    it('resolves every stable catalog ID against the actual bundled native definitions', () => {
        const catalog = buildFurnishingCatalog(source);
        expect(catalog.diagnostics).toEqual([]);
        expect(catalog.items.length).toBe(FURNISHING_CATALOG_SPECS.length);
        expect(new Set(catalog.items.map(item => item.id)).size).toBe(catalog.items.length);
        for (const item of catalog.items) {
            expect(item.variants.length).toBeGreaterThan(0);
            for (const variant of item.variants) {
                const entry = item.definition.entries.find(entry => entry.orient === variant.orient)!;
                expect(variant.renderCells).toEqual(entry.tiles.map(tile => ({ x: tile.x, y: tile.y })));
                expect(variant.footprint.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y))).toBeTrue();
                expect(variant.accessCells.some(cell => variant.footprint.some(p => p.x === cell.x && p.y === cell.y))).toBeFalse();
            }
        }
        expect(catalog.items.find(item => item.id === 'basic.single-bed')?.variants.map(variant => variant.orient)).toEqual(['W', 'N', 'E', 'S']);
    });
    it('keeps render coverage, movement, access, wall anchors and support surfaces separate', () => {
        const catalog = buildFurnishingCatalog(source);
        const bed = catalog.items.find(item => item.id === 'basic.single-bed')!.variants.find(variant => variant.orient === 'W')!;
        expect(bed.footprint).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
        expect(bed.accessCells).toEqual([{ x: 0, y: 1 }, { x: 1, y: 1 }]);
        expect(bed.wallEdges).toEqual([{ x: 0, y: 0, side: 'W' }]);
        const rug = catalog.items.find(item => item.id === 'basic.rug')!.variants[0];
        expect(rug.renderCells.length).toBe(6); expect(rug.blockedCells).toEqual([]);
        const counter = catalog.items.find(item => item.id === 'basic.counter')!.variants[0];
        expect(counter.surfaceCells).toEqual([{ x: 0, y: 0 }]);
        expect(counter.blockedCells).toEqual([{ x: 0, y: 0 }]);
    });
    it('reports missing catalog sources rather than selecting an unrelated item', () => {
        const catalog = buildFurnishingCatalog('version = 0');
        expect(catalog.items).toEqual([]); expect(catalog.diagnostics.length).toBe(FURNISHING_CATALOG_SPECS.length);
    });
    it('rejects incompatible source matches instead of relying on their position in the file', () => {
        const sourceFor = (other: string) => `furniture {\nentry {\norient = W\n0,0 = furniture_bedding_01_002\n1,0 = ${other}\n}\n}`;
        const catalog = buildFurnishingCatalog(`group {\nlabel = Furniture - Bedding\n${sourceFor('first_000')}\n${sourceFor('second_000')}\n}`);
        expect(catalog.items.find(item => item.id === 'basic.single-bed')).toBeUndefined();
        expect(catalog.diagnostics.find(diagnostic => diagnostic.catalogId === 'basic.single-bed')?.code).toBe('catalog-source-ambiguous');
    });
    it('shares native parser semantics for corner furniture, layers and grime, and rejects malformed input', () => {
        const groups = parseFurnitureGroups(source);
        expect(groups.find(group => group.label === 'Fixtures - Counters')?.furniture[0].corners).toBeTrue();
        expect(groups.find(group => group.label === 'Floors - Rugs')?.furniture[0].layer).toBe('FloorFurniture');
        expect(parseFurnitureGroups('group {\nlabel = Test\nfurniture {\nentry {\norient = NW\ngrime = false\n0,0 = tile_000\n}\n}\n}')[0].furniture[0].entries[0].grime).toBeFalse();
        expect(() => parseFurnitureGroups('group {')).toThrowError(/Unclosed/);
        expect(() => parseFurnitureGroups('}')).toThrowError(/Unexpected/);
    });
    it('checks availability per actual orientation, refreshes it after downloads and leaves the document unchanged', async () => {
        const downloaded = new Set<string>(), db = { getTile: async (name: string) => downloaded.has(name) ? { name } : null };
        const service = new AutoFurnishingAnalysisService({ get: () => of(source) } as any, db as any);
        const building = readBuildingFile(new DOMParser().parseFromString(nativeBuildingXml, 'text/xml'));
        const before = JSON.stringify(building), first = await service.prepare(building);
        expect(first.availability.every(variant => !variant.available)).toBeTrue();
        downloaded.add('appliances_refrigeration_01_001.png');
        const next = await service.prepare(building);
        expect(next.availability.find(variant => variant.catalogId === 'basic.refrigerator' && variant.orient === 'W')?.available).toBeTrue();
        expect(next.availability.find(variant => variant.catalogId === 'basic.refrigerator' && variant.orient === 'N')?.available).toBeFalse();
        expect(JSON.stringify(building)).toBe(before);
    });
});
