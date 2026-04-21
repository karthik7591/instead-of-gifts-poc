import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CampaignService } from '../../../core/services/campaign.service';
import { ProService } from '../../../core/services/pro.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';

const PENDING_PRO_UPGRADE_CAMPAIGN_KEY = 'pendingProUpgradeCampaignId';

@Component({
  selector: 'app-upgrade-success',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent],
  template: `
    <div class="success-page">
      <div class="success-card">
        @if (loading()) {
          <svg class="success-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-label="Loading...">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <p class="success-card__hint">Finishing your payment...</p>
        } @else {
          <div class="success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <h1 class="success-card__heading">{{ error() ? 'Payment not confirmed' : 'Payment complete' }}</h1>
          <p class="success-card__body">
            @if (error()) {
              {{ error() }}
            } @else {
              {{ confirmationMessage() }}
            }
          </p>
          <app-button variant="pro" size="md" [routerLink]="primaryActionLink()">
            {{ primaryActionLabel() }}
          </app-button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .success-page {
      min-height: 100vh;
      background: var(--color-pale-green, #EAF4DF);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
    }
    .success-card {
      background: #fff;
      border: 1px solid #C8DAC2;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(74,114,85,.12);
      padding: 3rem 2.5rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }
    .success-spinner {
      width: 2.5rem;
      height: 2.5rem;
      animation: spin 1s linear infinite;
      color: var(--color-brand-green, #95C476);
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .success-icon {
      width: 4rem;
      height: 4rem;
      border-radius: 50%;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #16a34a;
      svg { width: 2rem; height: 2rem; }
    }
    .success-card__heading {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--color-text-dark, #1E2D23);
    }
    .success-card__body,
    .success-card__hint {
      font-size: 0.9375rem;
      color: var(--color-text-muted, #6A8272);
      line-height: 1.6;
    }
  `],
})
export class UpgradeSuccessComponent implements OnInit {
  private readonly campaignSvc = inject(CampaignService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly supabase = inject(SupabaseService);
  private readonly proSvc = inject(ProService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly campaignCredits = this.proSvc.campaignCredits;
  readonly upgradedCampaignId = signal<string | null>(null);
  readonly confirmationMessage = signal('Payment complete.');
  readonly primaryActionLabel = signal('Dashboard');
  readonly primaryActionLink = signal<string[]>(['/dashboard']);

  async ngOnInit(): Promise<void> {
    const url = new URL(window.location.href);
    const provider = url.searchParams.get('provider') ?? 'stripe';
    const sessionId = url.searchParams.get('session_id');
    const paypalOrderId = url.searchParams.get('token');
    const alreadyConfirmed = url.searchParams.get('confirmed') === 'true';
    const campaignId = url.searchParams.get('campaignId') ?? this.getPendingUpgradeCampaignId();
    const upgradedCampaignIdFromUrl = url.searchParams.get('upgradedCampaignId');

    try {
      if ((provider === 'paypal' || provider === 'venmo') && paypalOrderId && !alreadyConfirmed) {
        const { data, error } = await this.supabase.client.functions.invoke<{
          campaignCredits?: number;
          upgradedCampaignId?: string | null;
        }>('confirm-paypal-campaign-payment', {
          body: { orderId: paypalOrderId },
        });
        if (error) throw new Error(error.message || 'Failed to confirm the PayPal payment.');
        this.upgradedCampaignId.set(data?.upgradedCampaignId ?? null);
        this.updateConfirmationMessage(data?.campaignCredits ?? this.campaignCredits(), data?.upgradedCampaignId ?? null);
      } else if (provider === 'venmo' && alreadyConfirmed) {
        this.upgradedCampaignId.set(upgradedCampaignIdFromUrl);
      } else if (sessionId) {
        const { data, error } = await this.supabase.client.functions.invoke<{
          campaignCredits?: number;
          upgradedCampaignId?: string | null;
        }>('confirm-stripe-campaign-payment', {
          body: { sessionId },
        });
        if (error) throw new Error(error.message || 'Failed to confirm the Stripe payment.');
        this.upgradedCampaignId.set(data?.upgradedCampaignId ?? null);
        this.updateConfirmationMessage(data?.campaignCredits ?? this.campaignCredits(), data?.upgradedCampaignId ?? null);
      } else {
        throw new Error('Missing payment confirmation details in the return URL.');
      }

      await this.proSvc.loadProfile();
      await this.autoUpgradeCampaignIfNeeded(campaignId);
      this.updateConfirmationMessage(this.campaignCredits(), this.upgradedCampaignId());
      await this.redirectToCampaignEditIfPossible(campaignId);
      this.clearPendingUpgradeCampaign();
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Failed to confirm the campaign payment.');
    } finally {
      this.loading.set(false);
    }
  }

  private updateConfirmationMessage(campaignCredits: number, upgradedCampaignId: string | null): void {
    if (upgradedCampaignId) {
      this.confirmationMessage.set('Your campaign is now Pro. No extra steps are needed.');
      return;
    }

    this.confirmationMessage.set('Payment complete. Your Pro access is ready.');
  }

  private async autoUpgradeCampaignIfNeeded(campaignId: string | null): Promise<void> {
    if (!campaignId || this.upgradedCampaignId()) {
      return;
    }

    if (this.campaignCredits() <= 0) {
      return;
    }

    const upgradedCampaign = await this.campaignSvc.upgradeCampaignWithCredit(campaignId);
    this.upgradedCampaignId.set(upgradedCampaign.id);
    await this.proSvc.loadProfile();
  }

  private async redirectToCampaignEditIfPossible(fallbackCampaignId: string | null): Promise<void> {
    const campaignId = this.upgradedCampaignId() ?? fallbackCampaignId;
    if (!campaignId) {
      return;
    }

    const campaign = await this.campaignSvc.getCampaignById(campaignId);
    if (!campaign) {
      return;
    }

    const editLink = ['/campaigns', campaign.slug, 'edit'];
    this.primaryActionLabel.set('Back to Edit Page');
    this.primaryActionLink.set(editLink);
    await this.router.navigate(editLink, { replaceUrl: true });
  }

  private getPendingUpgradeCampaignId(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }

    return window.sessionStorage.getItem(PENDING_PRO_UPGRADE_CAMPAIGN_KEY);
  }

  private clearPendingUpgradeCampaign(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    window.sessionStorage.removeItem(PENDING_PRO_UPGRADE_CAMPAIGN_KEY);
  }
}
