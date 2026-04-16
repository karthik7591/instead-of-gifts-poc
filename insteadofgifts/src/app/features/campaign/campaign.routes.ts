import { Routes } from '@angular/router';
import { authGuard } from '../../core/guards/auth.guard';

export const CAMPAIGN_ROUTES: Routes = [
  {
    path: 'all',
    loadComponent: () =>
      import('./list/campaign-list.component').then(
        (m) => m.CampaignListComponent
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./campaign.component').then((m) => m.CampaignComponent),
  },
  {
    path: 'new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./create/campaign-create.component').then(
        (m) => m.CampaignCreateComponent
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./view/campaign-view.component').then(
        (m) => m.CampaignViewComponent
      ),
  },
  {
    path: ':id/edit',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./edit/campaign-edit.component').then(
        (m) => m.CampaignEditComponent
      ),
  },
];
