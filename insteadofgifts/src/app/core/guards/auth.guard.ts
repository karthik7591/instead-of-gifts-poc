import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

/**
 * Functional route guard that blocks access to authenticated-only routes.
 * Reads the current Supabase session (cached — no network round-trip after login)
 * and redirects unauthenticated visitors to the home page.
 */
export const authGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router   = inject(Router);

  const { data: { session } } = await supabase.client.auth.getSession();
  if (session) return true;

  // Not signed in — redirect to the login page
  return router.createUrlTree(['/login']);
};
