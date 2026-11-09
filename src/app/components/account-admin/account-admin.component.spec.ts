import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AccountUser, PROTECTED_ADMIN_UID } from '../../models/account.models';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';
import { AccountAdminComponent } from './account-admin.component';

describe('Admin account management', () => {
  let api: jasmine.SpyObj<ProjectApiService>;
  const normal: AccountUser = { uid: 'person', email: 'person@example.test', displayName: 'Person', type: 'normal', revision: 0, protected: false };
  const original: AccountUser = { ...normal, uid: PROTECTED_ADMIN_UID, type: 'admin', protected: true };
  beforeEach(() => {
    api = jasmine.createSpyObj('ProjectApiService', ['request']);
    api.request.and.resolveTo({ users: [normal, original], nextPageToken: null });
    TestBed.configureTestingModule({ declarations: [AccountAdminComponent], imports: [CommonModule, FormsModule, RouterTestingModule],
      providers: [{ provide: ProjectApiService, useValue: api }, { provide: AuthService,
        useValue: { user: { uid: PROTECTED_ADMIN_UID }, isAdmin: true } }] });
  });
  it('shows account types and keeps the original admin controls disabled', async () => {
    const fixture = TestBed.createComponent(AccountAdminComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await fixture.whenStable();
    const selects = fixture.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>;
    expect(selects[0].disabled).toBeFalse();
    expect(selects[1].disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Original admin');
  });
  it('saves an Admin promotion with the current account revision', async () => {
    const fixture = TestBed.createComponent(AccountAdminComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    component.drafts[normal.uid] = 'admin';
    api.request.and.resolveTo({ ...normal, type: 'admin', revision: 1 });
    await component.save(normal);
    expect(api.request).toHaveBeenCalledWith('PUT', '/accounts/person', { type: 'admin', revision: 0 });
    expect(component.users[0].type).toBe('admin');
  });
  it('preserves the selection and shows stale update errors', async () => {
    const fixture = TestBed.createComponent(AccountAdminComponent);
    fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance;
    component.drafts[normal.uid] = 'contributor';
    api.request.and.rejectWith(new Error('This account changed. Refresh the list before saving.'));
    await component.save(normal);
    expect(component.drafts[normal.uid]).toBe('contributor');
    expect(component.error).toContain('Refresh');
    expect(component.users[0].type).toBe('normal');
  });
});
