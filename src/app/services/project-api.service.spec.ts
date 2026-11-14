import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { ProjectApiService } from './project-api.service';
import { THAMES_VALLEY_PROJECT_ID } from '../utils/default-project';

describe('Project API guest access', () => {
  let http: HttpTestingController, api: ProjectApiService;
  let auth: { user: { uid: string } | null; apiBaseUrl: string; token: jasmine.Spy };
  beforeEach(() => {
    auth = { user: null, apiBaseUrl: 'https://api.example/workspaceApi', token: jasmine.createSpy('token').and.resolveTo('google-token') };
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule], providers: [{ provide: AuthService, useValue: auth }] });
    http = TestBed.inject(HttpTestingController); api = TestBed.inject(ProjectApiService);
  });
  afterEach(() => http.verify());
  it('reads guest tasks without Firebase authentication', async () => {
    const result = api.tasks(THAMES_VALLEY_PROJECT_ID);
    const request = http.expectOne(`https://api.example/workspaceApi/guest/projects/${THAMES_VALLEY_PROJECT_ID}/tasks`);
    expect(request.request.headers.has('Authorization')).toBeFalse(); expect(auth.token).not.toHaveBeenCalled();
    request.flush([]); expect(await result).toEqual([]);
  });
  it('retains authenticated API paths for signed-in users', async () => {
    auth.user = { uid: 'admin' }; const result = api.tasks(THAMES_VALLEY_PROJECT_ID); await Promise.resolve();
    const request = http.expectOne(`https://api.example/workspaceApi/projects/${THAMES_VALLEY_PROJECT_ID}/tasks`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer google-token'); request.flush([]); await result;
  });
});
