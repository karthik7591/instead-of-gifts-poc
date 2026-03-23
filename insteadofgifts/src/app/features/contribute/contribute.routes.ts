import { Routes } from '@angular/router';

export const CONTRIBUTE_ROUTES: Routes = [
  {
    path: ':slug',
    loadComponent: () =>
      import('./contribute.component').then((m) => m.ContributeComponent),
  },
];
