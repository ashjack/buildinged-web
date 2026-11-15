import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { WORLD_BUILDING_SAVED_KEY, WorldBuildingSaved, WorldBuildingUpdatesService } from './world-building-updates.service';

describe('Building saves across tabs', () => {
    let service: WorldBuildingUpdatesService, received: WorldBuildingSaved[];
    const event = (changes: Partial<WorldBuildingSaved> = {}): WorldBuildingSaved => ({ id: crypto.randomUUID(),
        userId: 'admin', apiBaseUrl: 'https://example.test/api', projectId: 'project', path: 'Buildings/house.tbx', previousRevision: 5, revision: 6, ...changes });
    const send = (value: unknown) => window.dispatchEvent(new StorageEvent('storage', { key: WORLD_BUILDING_SAVED_KEY, newValue: JSON.stringify(value) }));
    beforeEach(() => {
        localStorage.removeItem(WORLD_BUILDING_SAVED_KEY);
        TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { user: { uid: 'admin' }, apiBaseUrl: 'https://example.test/api' } }] });
        service = TestBed.inject(WorldBuildingUpdatesService); received = [];
        service.changes$.subscribe(change => received.push(change));
    });
    afterEach(() => localStorage.removeItem(WORLD_BUILDING_SAVED_KEY));
    it('publishes committed metadata without putting building XML into the notification', () => {
        service.publish({ projectId: 'project', path: 'Buildings/house.tbx', revision: 6, xml: '<building/>' } as any, 5);
        const saved = JSON.parse(localStorage.getItem(WORLD_BUILDING_SAVED_KEY)!);
        expect(saved).toEqual(jasmine.objectContaining({ userId: 'admin', projectId: 'project', revision: 6, previousRevision: 5 }));
        expect(saved.xml).toBeUndefined(); expect(received.length).toBe(1);
        send(saved); expect(received.length).toBe(1);
    });
    it('receives updates from another tab and ignores duplicate transports, other accounts and other APIs', () => {
        const value = event(); send(value); send(value);
        send(event({ userId: 'someone-else' })); send(event({ apiBaseUrl: 'https://other.test/api' }));
        expect(received).toEqual([value]);
    });
    it('ignores malformed events and non-building resources', () => {
        for (const invalid of [null, {}, event({ path: 'maps/cell.tmx' }), event({ revision: 4 }), event({ revision: 6.5 }), event({ path: '/outside.tbx' })]) send(invalid);
        expect(received).toEqual([]);
    });
    it('checks the last save after the viewer regains focus', () => {
        const value = event(); localStorage.setItem(WORLD_BUILDING_SAVED_KEY, JSON.stringify(value));
        window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus'));
        expect(received).toEqual([value]);
    });
    it('does not fail a completed save when browser storage is full', () => {
        spyOn(localStorage, 'setItem').and.throwError('Storage full');
        expect(() => service.publish({ projectId: 'project', path: 'Buildings/house.tbx', revision: 6 }, 5)).not.toThrow();
        expect(received.length).toBe(1);
    });
});
