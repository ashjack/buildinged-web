import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './services/auth.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnDestroy {
  title = 'buildinged-web';
  private readonly permissions: Subscription;
  constructor(auth: AuthService, router: Router) {
    this.permissions = auth.user$.subscribe(() => {
      if ((!auth.canViewWorlds && /^\/(worlded|tilezed)(\/|\?|$)/.test(router.url)) ||
          (!auth.isAdmin && /^\/admin(\/|\?|$)/.test(router.url))) void router.navigate(['/']);
    });
  }
  ngOnDestroy(): void { this.permissions.unsubscribe(); }
}
