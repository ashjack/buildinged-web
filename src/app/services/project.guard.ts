import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ProjectGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) { }
  canActivate(): boolean | UrlTree {
    return !!this.auth.user || this.router.createUrlTree(['/'], { queryParams: { signIn: 'required' } });
  }
}
