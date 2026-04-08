import { Routes } from '@angular/router';

export const PRO_ROUTES: Routes = [
  {
    path: 'upgrade',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./upgrade/upgrade.component').then((m) => m.UpgradeComponent),
      },
      {
        path: 'payment',
        loadComponent: () =>
          import('./upgrade/upgrade-payment.component').then(
            (m) => m.UpgradePaymentComponent
          ),
      },
      {
        path: 'success',
        loadComponent: () =>
          import('./upgrade/upgrade-success.component').then(
            (m) => m.UpgradeSuccessComponent
          ),
      },
    ],
  },
  // Redirect bare /pro to /pro/upgrade
  { path: '', redirectTo: 'upgrade', pathMatch: 'full' },
];
