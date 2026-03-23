import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

/**
 * Blocks authenticated users from accessing public-only routes (e.g. /login).
 * Redirects them to /dashboard when a session already exists.
 */
export const unauthGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router   = inject(Router);

  const { data: { session } } = await supabase.client.auth.getSession();
  if (!session) return true;

  return router.createUrlTree(['/dashboard']);
};
