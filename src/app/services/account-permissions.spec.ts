import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import type { User } from 'firebase/auth';
import { PROTECTED_ADMIN_UID } from '../models/account.models';
import { AdminGuard } from './admin.guard';
import { AuthService } from './auth.service';
import { WorldViewerGuard } from './world-viewer.guard';

describe('Account permissions', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let router: Router;
  function signIn(uid = 'person'): void {
    const user = { uid, getIdToken: async () => 'firebase-token' } as User;
    (auth as unknown as { userSubject: BehaviorSubject<User | null> }).userSubject.next(user);
  }
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule, RouterTestingModule] });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    Object.assign(auth, { config: { apiBaseUrl: 'http://localhost/api' } });
  });
  afterEach(() => http.verify());
  it('denies both direct viewer routes and lazy loading to Normal and anonymous accounts', () => {
    const guard = TestBed.inject(WorldViewerGuard);
    expect(guard.canActivate()).not.toBeTrue();
    signIn();
    expect(auth.accountType).toBe('normal');
    expect(guard.canActivate()).not.toBeTrue();
    expect(guard.canMatch()).not.toBeTrue();
    expect(router.serializeUrl(guard.canMatch() as ReturnType<Router['createUrlTree']>)).toContain('contributor-required');
    expect(TestBed.inject(AdminGuard).canActivate()).not.toBeTrue();
  });
  it('permits Contributor viewers and promoted Admin tools while keeping the original admin protected', () => {
    signIn();
    auth.accountType = 'contributor';
    expect(TestBed.inject(WorldViewerGuard).canActivate()).toBeTrue();
    expect(TestBed.inject(AdminGuard).canActivate()).not.toBeTrue();
    auth.accountType = 'admin';
    expect(TestBed.inject(AdminGuard).canActivate()).toBeTrue();
    signIn(PROTECTED_ADMIN_UID);
    auth.accountType = 'normal';
    expect(auth.isAdmin).toBeTrue();
    expect(auth.canViewWorlds).toBeTrue();
  });
  it('loads account types from the authenticated API and applies demotion without refreshing the sign-in token', async () => {
    signIn();
    const promote = auth.refreshAccount();
    await Promise.resolve();
    const request = http.expectOne('http://localhost/api/account');
    expect(request.request.headers.get('Authorization')).toBe('Bearer firebase-token');
    request.flush({ type: 'admin' });
    await promote;
    expect(auth.isAdmin).toBeTrue();
    const demote = auth.refreshAccount();
    await Promise.resolve();
    http.expectOne('http://localhost/api/account').flush({ type: 'normal' });
    await demote;
    expect(auth.isAdmin).toBeFalse();
    expect(auth.canViewWorlds).toBeFalse();
  });
  it('fails closed when the permissions API is unavailable', async () => {
    signIn();
    auth.accountType = 'contributor';
    const loading = auth.refreshAccount();
    await Promise.resolve();
    http.expectOne('http://localhost/api/account').flush({}, { status: 503, statusText: 'Unavailable' });
    await loading;
    expect(auth.accountType).toBe('normal');
    expect(auth.canViewWorlds).toBeFalse();
  });
});
