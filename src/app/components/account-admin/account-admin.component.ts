import { Component, OnInit } from '@angular/core';
import { AccountType, AccountUser } from '../../models/account.models';
import { AuthService } from '../../services/auth.service';
import { ProjectApiService } from '../../services/project-api.service';

@Component({
  selector: 'app-account-admin',
  templateUrl: './account-admin.component.html',
  styleUrls: ['../tile-admin/tile-admin.component.scss', './account-admin.component.scss']
})
export class AccountAdminComponent implements OnInit {
  users: AccountUser[] = [];
  drafts: Record<string, AccountType> = {};
  email = '';
  nextPageToken: string | null = null;
  loading = false;
  saving = '';
  error = '';
  notice = '';
  constructor(public auth: AuthService, private api: ProjectApiService) { }
  ngOnInit(): void { void this.load(); }
  async load(more = false): Promise<void> {
    if (this.loading || this.saving) return;
    this.loading = true;
    this.error = '';
    try {
      const query = this.email.trim() ? `?email=${encodeURIComponent(this.email.trim())}`
        : more && this.nextPageToken ? `?pageToken=${encodeURIComponent(this.nextPageToken)}` : '';
      const page = await this.api.request<{ users: AccountUser[]; nextPageToken: string | null }>('GET', `/accounts${query}`);
      this.users = more ? [...this.users, ...page.users] : page.users;
      this.nextPageToken = page.nextPageToken;
      for (const user of page.users) this.drafts[user.uid] = user.type;
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { this.loading = false; }
  }
  async save(user: AccountUser): Promise<void> {
    if (this.saving || user.protected || this.loading) return;
    this.saving = user.uid;
    this.error = this.notice = '';
    try {
      const updated = await this.api.request<AccountUser>('PUT', `/accounts/${encodeURIComponent(user.uid)}`, {
        type: this.drafts[user.uid], revision: user.revision
      });
      this.users = this.users.map(item => item.uid === updated.uid ? updated : item);
      this.drafts[updated.uid] = updated.type;
      this.notice = `Account type saved for ${updated.email || updated.uid}.`;
      if (updated.uid === this.auth.user?.uid) await this.auth.refreshAccount();
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { this.saving = ''; }
  }
}
