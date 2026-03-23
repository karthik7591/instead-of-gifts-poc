import { Injectable, inject, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';

interface UserProfile {
  id:                     string;
  is_pro:                 boolean;
  stripe_customer_id:     string | null;
  stripe_subscription_id: string | null;
  pro_since:              string | null;
}

/**
 * ProService — tracks the current user's Pro subscription status.
 *
 * Bootstraps by reading `user_profiles` from Supabase on service creation and
 * whenever the auth state changes. The `isPro` signal is the single source of
 * truth consumed by guards, the dashboard banner, and the create-campaign form.
 */
@Injectable({ providedIn: 'root' })
export class ProService {
  private readonly supabase  = inject(SupabaseService);
  private readonly toastSvc  = inject(ToastService);

  private readonly _profile = signal<UserProfile | null>(null);

  /** True when the current user has an active Pro subscription. */
  readonly isPro = computed(() => this._profile()?.is_pro ?? false);

  constructor() {
    // Re-load profile whenever the Supabase auth session changes
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void this.loadProfile();
      } else {
        this._profile.set(null);
      }
    });

    // Bootstrap immediately in case the user is already signed in
    void this.loadProfile();
  }

  /**
   * (Re-)fetches the user's profile row.
   * Call this after a successful Pro upgrade to pick up the new `is_pro` value.
   */
  async loadProfile(): Promise<void> {
    const { data: { user } } = await this.supabase.client.auth.getUser();

    if (!user) {
      this._profile.set(null);
      return;
    }

    const { data, error } = await this.supabase.client
      .from('user_profiles')
      .select('id, is_pro, stripe_customer_id, stripe_subscription_id, pro_since')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[ProService] Failed to load user profile:', error.message);
      this.toastSvc.error('Failed to load subscription status — some features may be unavailable.');
      return;
    }

    this._profile.set(data);
  }
}
