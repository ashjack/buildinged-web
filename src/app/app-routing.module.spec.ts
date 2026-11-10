import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { AppRoutingModule } from './app-routing.module';
import { AuthService } from './services/auth.service';

describe('Task creation routing', () => {
  it('resolves tasks/new as creation rather than a task whose ID is new', async () => {
    TestBed.configureTestingModule({ imports: [RouterTestingModule, AppRoutingModule],
      providers: [{ provide: AuthService, useValue: { user: { uid: 'admin' } } }] });
    const router = TestBed.inject(Router);
    try {
      expect(await router.navigateByUrl('/projects/project/tasks/new?worldBuilding=Buildings%2Fhouse.tbx')).toBeTrue();
      const route = router.routerState.snapshot.root.firstChild!;
      expect(route.data['createTask']).toBeTrue();
      expect(route.paramMap.get('projectId')).toBe('project');
      expect(route.paramMap.get('taskId')).toBeNull();
      expect(route.queryParamMap.get('worldBuilding')).toBe('Buildings/house.tbx');
    } finally { router.dispose(); }
  });
});
