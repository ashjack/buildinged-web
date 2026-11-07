import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { StoreModule } from '@ngrx/store';
import { BehaviorSubject } from 'rxjs';
import { reducer } from '../../../app.reducers';
import { AuthService } from '../../../services/auth.service';
import { BuildingService } from '../../../services/building.service';
import { ProjectApiService } from '../../../services/project-api.service';
import { BuildingSelectionWindowComponent } from './building-selection-window.component';

describe('Project-list homepage', () => {
  let api: jasmine.SpyObj<ProjectApiService>;
  let buildings: jasmine.SpyObj<BuildingService>;
  let user: BehaviorSubject<{ uid: string } | null>;
  beforeEach(() => {
    user = new BehaviorSubject<{ uid: string } | null>(null);
    api = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['projects']);
    api.projects.and.resolveTo([{ id: 'project', name: 'Map project', description: 'Shared', visibility: 'public', role: 'contributor' }]);
    buildings = jasmine.createSpyObj<BuildingService>('BuildingService', ['getTemplateNames', 'createNewBuilding']);
    buildings.getTemplateNames.and.resolveTo([]);
    buildings.createNewBuilding.and.resolveTo();
    TestBed.configureTestingModule({
      declarations: [BuildingSelectionWindowComponent],
      imports: [CommonModule, FormsModule, RouterTestingModule, StoreModule.forRoot({}), StoreModule.forFeature('root', reducer)],
      providers: [
        { provide: AuthService, useValue: { get user() { return user.value; }, user$: user.asObservable() } },
        { provide: ProjectApiService, useValue: api }, { provide: BuildingService, useValue: buildings }
      ]
    });
  });

  it('does not fetch projects before Google sign-in and keeps standalone creation available', async () => {
    const fixture = TestBed.createComponent(BuildingSelectionWindowComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(api.projects).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Sign in with Google');
    expect(fixture.nativeElement.textContent).toContain('New building');
    expect(fixture.nativeElement.querySelector('a[href="/tilezed"]')?.textContent).toContain('TileZed');
    expect(fixture.nativeElement.querySelector('a[href="/worlded"]')?.textContent).toContain('WorldEd');
  });

  it('shows routed project links after sign-in and clears them on sign-out', async () => {
    const fixture = TestBed.createComponent(BuildingSelectionWindowComponent);
    fixture.detectChanges();
    user.next({ uid: 'user' });
    await fixture.whenStable(); fixture.detectChanges();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.project-row');
    expect(link.getAttribute('href')).toBe('/projects/project');
    user.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Map project');
  });

  it('creating a standalone building navigates to the isolated editor', async () => {
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(BuildingSelectionWindowComponent);
    fixture.detectChanges(); await fixture.whenStable();
    await fixture.componentInstance.createNewBuilding();
    expect(buildings.createNewBuilding).toHaveBeenCalledWith('', { width: 24, height: 20 });
    expect(navigate).toHaveBeenCalledWith(['/editor']);
  });
});
