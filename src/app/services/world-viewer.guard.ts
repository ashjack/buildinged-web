import { Injectable } from '@angular/core';
import { CanActivate, CanMatch, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class WorldViewerGuard implements CanActivate, CanMatch {
  constructor(private auth: AuthService, private router: Router) { }
  canActivate(): boolean | UrlTree {
    return this.auth.canViewWorlds || this.router.createUrlTree(['/'], {
      queryParams: this.auth.user ? { access: 'contributor-required' } : { signIn: 'required' }
    });
  }
  canMatch(): boolean | UrlTree { return this.canActivate(); }
}
