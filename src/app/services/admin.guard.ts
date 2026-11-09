import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

// The original admin remains protected; assigned account types come from the API.
export const ADMIN_UIDS: readonly string[] = ['gK0MQfxb5XVs8SGlF1GVKUYXQdK2'];
export function isAdmin(uid: string | null | undefined): boolean { return !!uid && ADMIN_UIDS.includes(uid); }

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) { }
  canActivate(): boolean | UrlTree {
    return this.auth.isAdmin || this.router.createUrlTree(['/']);
  }
}
