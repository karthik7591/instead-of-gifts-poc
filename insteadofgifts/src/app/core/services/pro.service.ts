import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';

interface UserProfile {
  id: string;
  is_pro: boolean;
  stripe_customer_id: string | null;
  pro_payment_provider: string | null;
  pro_since: string | null;
  campaign_pro_credits: number;
}

type UserProfileRow = Partial<UserProfile> & { id: string };

@Injectable({ providedIn: 'root' })
export class ProService {
  private readonly supabase = inject(SupabaseService);
  private readonly toastSvc = inject(ToastService);

  private readonly _profile = signal<UserProfile | null>(null);

  readonly isPro = computed(() => this._profile()?.is_pro ?? false);
  readonly campaignCredits = computed(() => this._profile()?.campaign_pro_credits ?? 0);
  readonly canCreatePaidCampaign = computed(() => this.campaignCredits() > 0);

  constructor() {
    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void this.loadProfile();
      } else {
        this._profile.set(null);
      }
    });

    void this.loadProfile();
  }

  async loadProfile(): Promise<void> {
    const { data: { user } } = await this.supabase.client.auth.getUser();

    if (!user) {
      this._profile.set(null);
      return;
    }

    const { data, error } = await this.supabase.client
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle<UserProfileRow>();

    if (error) {
      console.error('[ProService] Failed to load user profile:', error.message);
      this.toastSvc.error('Failed to load payment status.');
      return;
    }

    if (!data) {
      this._profile.set(null);
      return;
    }

    this._profile.set({
      id: data.id,
      is_pro: data.is_pro ?? false,
      stripe_customer_id: data.stripe_customer_id ?? null,
      pro_payment_provider: data.pro_payment_provider ?? null,
      pro_since: data.pro_since ?? null,
      campaign_pro_credits: data.campaign_pro_credits ?? 0,
    });
  }
}
