import { Routes } from '@angular/router';
import { unauthGuard } from '../../core/guards/unauth.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [unauthGuard],
    loadComponent: () =>
      import('./login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'callback',
    loadComponent: () =>
      import('./callback/auth-callback.component').then(
        (m) => m.AuthCallbackComponent
      ),
  },
];
