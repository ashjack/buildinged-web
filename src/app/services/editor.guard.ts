import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, CanDeactivate, Router } from '@angular/router';
import { EditorComponent } from '../components/editor/editor.component';
import { EditorSessionService } from './editor-session.service';

@Injectable({ providedIn: 'root' })
export class EditorGuard implements CanDeactivate<EditorComponent>, CanActivate {
  constructor(private session: EditorSessionService, private router: Router) { }
  canActivate(route: ActivatedRouteSnapshot): boolean {
    const current = this.router.routerState.snapshot.root.firstChild;
    const reusingEditor = current?.routeConfig === route.routeConfig;
    return !reusingEditor || !this.session.contribution ||
      this.session.contribution.id === route.paramMap.get('variantId') || this.session.canLeave();
  }
  canDeactivate(component: EditorComponent): boolean { return component.canLeave(); }
}
