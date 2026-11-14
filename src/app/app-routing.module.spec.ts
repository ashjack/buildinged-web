import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { AppRoutingModule } from './app-routing.module';
import { AuthService } from './services/auth.service';
import { THAMES_VALLEY_PROJECT_ID } from './utils/default-project';

describe('Task creation routing', () => {
  it('resolves tasks/new as creation rather than a task whose ID is new', async () => {
    TestBed.configureTestingModule({ imports: [RouterTestingModule, AppRoutingModule],
      providers: [{ provide: AuthService, useValue: { user: { uid: 'admin' } } }] });
    const router = TestBed.inject(Router);
    try {
      expect(await router.navigateByUrl(`/projects/${THAMES_VALLEY_PROJECT_ID}/tasks/new?worldBuilding=Buildings%2Fhouse.tbx`)).toBeTrue();
      const route = router.routerState.snapshot.root.firstChild!;
      expect(route.data['createTask']).toBeTrue();
      expect(route.paramMap.get('projectId')).toBe(THAMES_VALLEY_PROJECT_ID);
      expect(route.paramMap.get('taskId')).toBeNull();
      expect(route.queryParamMap.get('worldBuilding')).toBe('Buildings/house.tbx');
    } finally { router.dispose(); }
  });
  it('opens Thames Valley without login and redirects other project routes into it', async () => {
    TestBed.configureTestingModule({ imports: [RouterTestingModule, AppRoutingModule], providers: [{ provide: AuthService, useValue: { user: null } }] });
    const router = TestBed.inject(Router);
    try {
      await router.navigateByUrl('/'); expect(router.url).toBe(`/projects/${THAMES_VALLEY_PROJECT_ID}`);
      await router.navigateByUrl('/projects/another-project'); expect(router.url).toBe(`/projects/${THAMES_VALLEY_PROJECT_ID}`);
    } finally { router.dispose(); }
  });
});
