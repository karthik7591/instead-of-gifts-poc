import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { unauthGuard } from './core/guards/unauth.guard';

export const routes: Routes = [
  // ── Main layout (nav + footer) ──────────────────────────────────────────
  {
    path: '',
    loadComponent: () =>
      import('./layouts/main-layout/main-layout.component').then(
        (m) => m.MainLayoutComponent
      ),
    children: [
      {
        path: '',
        loadChildren: () =>
          import('./features/home/home.routes').then((m) => m.HOME_ROUTES),
      },
      {
        path: 'campaigns',
        loadChildren: () =>
          import('./features/campaign/campaign.routes').then(
            (m) => m.CAMPAIGN_ROUTES
          ),
      },
      {
        path: 'dashboard',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then(
            (m) => m.DASHBOARD_ROUTES
          ),
      },
      {
        path: 'pro',
        loadChildren: () =>
          import('./features/pro/pro.routes').then((m) => m.PRO_ROUTES),
      },
    ],
  },

  // ── Minimal layout (no nav, for focused flows) ──────────────────────────
  {
    path: 'contribute',
    loadComponent: () =>
      import('./layouts/minimal-layout/minimal-layout.component').then(
        (m) => m.MinimalLayoutComponent
      ),
    children: [
      {
        path: '',
        loadChildren: () =>
          import('./features/contribute/contribute.routes').then(
            (m) => m.CONTRIBUTE_ROUTES
          ),
      },
    ],
  },

  // ── Auth (standalone — own header/footer, no nav layout) ─────────────────
  {
    path: 'login',
    canActivate: [unauthGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then(
        (m) => m.LoginComponent
      ),
  },
  {
    path: 'auth',
    children: [
      {
        path: 'callback',
        loadComponent: () =>
          import('./features/auth/callback/auth-callback.component').then(
            (m) => m.AuthCallbackComponent
          ),
      },
    ],
  },

  // ── Fallback ─────────────────────────────────────────────────────────────
  { path: '**', redirectTo: '' },
];
