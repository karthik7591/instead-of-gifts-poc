import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { ProService } from '../services/pro.service';

/**
 * Functional route guard that blocks access to Pro-only routes.
 * Refreshes the profile first (in case the user just upgraded in another tab)
 * then redirects free users to the upgrade page.
 */
export const proGuard: CanActivateFn = async () => {
  const proSvc = inject(ProService);
  const router = inject(Router);

  // Refresh from DB so a just-upgraded user isn't bounced back
  await proSvc.loadProfile();

  if (proSvc.isPro()) return true;

  return router.createUrlTree(['/pro', 'upgrade']);
};
