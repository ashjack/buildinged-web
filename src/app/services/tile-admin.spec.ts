import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { AdminGuard, isAdmin } from './admin.guard';
import { AuthService } from './auth.service';
import { TileAdminService } from './tile-admin.service';
import { TileAdminComponent } from '../components/tile-admin/tile-admin.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';

const ADMIN = 'gK0MQfxb5XVs8SGlF1GVKUYXQdK2';

describe('admin access', () => {
  it('only recognises the configured admin uid', () => {
    expect(isAdmin(ADMIN)).toBeTrue();
    expect(isAdmin('someone-else')).toBeFalse();
    expect(isAdmin(null)).toBeFalse();
    expect(isAdmin(undefined)).toBeFalse();
  });

  it('redirects non-admins away from the admin route', () => {
    const tree = {} as UrlTree;
    const router = jasmine.createSpyObj<Router>('Router', ['createUrlTree']);
    router.createUrlTree.and.returnValue(tree);
    expect(new AdminGuard({ user: null } as AuthService, router).canActivate()).toBe(tree);
    expect(new AdminGuard({ user: { uid: 'other' } } as unknown as AuthService, router).canActivate()).toBe(tree);
    expect(new AdminGuard({ user: { uid: ADMIN }, isAdmin: true } as unknown as AuthService, router).canActivate()).toBeTrue();
    expect(new AdminGuard({ user: { uid: 'promoted-admin' }, isAdmin: true } as unknown as AuthService, router).canActivate()).toBeTrue();
  });

  it('builds folder slugs from pack names', () => {
    expect(TileAdminComponent.slugify("Pert's Party Tiles!")).toBe('pert-s-party-tiles');
    expect(TileAdminComponent.slugify('  Café  Décor ')).toBe('cafe-decor');
    expect(TileAdminComponent.slugify('a'.repeat(60) + ' b').length).toBeLessThanOrEqual(48);
  });
});

describe('Tile admin availability controls', () => {
  let api: jasmine.SpyObj<TileAdminService>;
  beforeEach(() => {
    api = jasmine.createSpyObj<TileAdminService>('TileAdminService', ['list', 'setAvailability']);
    api.list.and.resolveTo([
      { id: 'vanilla', name: 'Vanilla', url: 'vanilla.zip', format: 'zip', exists: true, size: 1, updatedAt: null, disabled: false, required: true },
      { id: 'custom', name: 'Custom', url: 'custom.zip', format: 'zip', exists: true, size: 1, updatedAt: null, disabled: false, required: false },
    ]);
    TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, RouterTestingModule], declarations: [TileAdminComponent],
      providers: [{ provide: TileAdminService, useValue: api }, { provide: AuthService, useValue: { user: null } }],
    });
  });
  it('saves each availability choice and restores the displayed choice after a failed save', async () => {
    const fixture = TestBed.createComponent(TileAdminComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const [vanilla, custom] = [...fixture.nativeElement.querySelectorAll('select')] as HTMLSelectElement[];
    expect(vanilla.disabled).toBeTrue(); expect(vanilla.value).toBe('required');
    expect(custom.value).toBe('optional');
    for (const value of ['disabled', 'required', 'optional']) {
      const settings = { disabled: value === 'disabled', required: value === 'required' };
      api.setAvailability.and.resolveTo(settings);
      custom.value = value; custom.dispatchEvent(new Event('change'));
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      expect(api.setAvailability).toHaveBeenCalledWith('custom', settings);
      expect(custom.value).toBe(value);
    }
    api.setAvailability.and.rejectWith(new Error('Save failed.'));
    custom.value = 'disabled'; custom.dispatchEvent(new Event('change'));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(custom.value).toBe('optional');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Save failed.');
  });
});

describe('TileAdminService', () => {
  let service: TileAdminService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: AuthService, useValue: { adminApiBaseUrl: 'https://api.test/adminApi', token: () => Promise.resolve('tok') } }],
    });
    service = TestBed.inject(TileAdminService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve));

  it('uploads directly to storage without the Firebase token, then publishes', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'pack.zip');
    const progress: number[] = [];
    const done = service.upload({ packId: 'mine', create: true, name: 'Mine' }, file, value => progress.push(value));

    await flushMicrotasks();
    const begin = http.expectOne('https://api.test/adminApi/tilepacks/uploads');
    expect(begin.request.method).toBe('POST');
    expect(begin.request.headers.get('Authorization')).toBe('Bearer tok');
    expect(begin.request.body).toEqual({ packId: 'mine', create: true, name: 'Mine', size: 3 });
    begin.flush({ uploadId: 'abc', uploadUrl: 'https://storage.test/session' });

    await flushMicrotasks();
    const put = http.expectOne('https://storage.test/session');
    expect(put.request.method).toBe('PUT');
    expect(put.request.headers.has('Authorization')).toBeFalse();
    put.flush('');

    await flushMicrotasks();
    const publish = http.expectOne('https://api.test/adminApi/tilepacks/publish');
    expect(publish.request.body).toEqual({ packId: 'mine', create: true, name: 'Mine', uploadId: 'abc' });
    publish.flush({ id: 'mine', sheets: 4, size: 3, updatedAt: 'now' });

    expect((await done).sheets).toBe(4);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('surfaces server error messages', async () => {
    const result = service.list().catch((error: Error) => error.message);
    await flushMicrotasks();
    http.expectOne('https://api.test/adminApi/tilepacks').flush({ error: 'Forbidden.' }, { status: 403, statusText: 'Forbidden' });
    expect(await result).toBe('Forbidden.');
  });

  it('saves availability with admin authentication without uploading a pack', async () => {
    const done = service.setAvailability('mine', { disabled: true, required: false });
    await flushMicrotasks();
    const request = http.expectOne('https://api.test/adminApi/tilepacks/mine/availability');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer tok');
    expect(request.request.body).toEqual({ disabled: true, required: false });
    request.flush({ disabled: true, required: false });
    expect(await done).toEqual({ disabled: true, required: false });
  });
});
