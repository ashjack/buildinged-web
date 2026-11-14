import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { THAMES_VALLEY_PROJECT_ID } from '../utils/default-project';

@Injectable({ providedIn: 'root' })
export class ProjectGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) { }
  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    return route.paramMap.get('projectId') === THAMES_VALLEY_PROJECT_ID || this.router.createUrlTree(['/projects', THAMES_VALLEY_PROJECT_ID]);
  }
}
