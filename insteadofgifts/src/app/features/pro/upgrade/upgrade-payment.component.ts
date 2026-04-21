import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { environment } from '../../../../environments/environment';
import { PayPalSdkService, PayPalNamespace } from '../../../core/services/paypal-sdk.service';

const PENDING_PRO_UPGRADE_CAMPAIGN_KEY = 'pendingProUpgradeCampaignId';

@Component({
  selector: 'app-upgrade-payment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, RouterLink],
  template: `
    <div class="payment-page">
      <div class="payment-card">
        <a
          class="payment-card__back"
          [routerLink]="['/pro/upgrade']"
          [queryParams]="upgradeCampaignId() ? { campaignId: upgradeCampaignId() } : null"
        >
          Back
        </a>

        <p class="payment-card__eyebrow">Campaign Access</p>
        <h1 class="payment-card__heading">Choose a payment method</h1>
        <p class="payment-card__sub">
          This is a one-time $9.99 payment to unlock Pro for one campaign.
        </p>

        <div class="order-summary" aria-label="Order summary">
          <div class="order-summary__row">
            <span class="order-summary__label">Item</span>
            <span class="order-summary__value">Campaign access</span>
          </div>
          <div class="order-summary__row">
            <span class="order-summary__label">Type</span>
            <span class="order-summary__value">One-time payment</span>
          </div>
          <div class="order-summary__row">
            <span class="order-summary__label">Access</span>
            <span class="order-summary__value">One Pro campaign</span>
          </div>
          <div class="order-summary__row order-summary__row--total">
            <span class="order-summary__label">Total</span>
            <span class="order-summary__value">$9.99</span>
          </div>
        </div>

        <div class="payment-actions">
          <app-button
            variant="campaign"
            size="md"
            [fullWidth]="true"
            [loading]="loading() && activeProvider() === 'stripe'"
            [disabled]="loading()"
            (click)="startStripeCheckout()"
          >
            Pay with Stripe
          </app-button>

          <app-button
            variant="pro"
            size="md"
            [fullWidth]="true"
            [loading]="loading() && activeProvider() === 'paypal'"
            [disabled]="loading()"
            (click)="startPayPalCheckoutFlow()"
          >
            Pay with PayPal
          </app-button>

          <div class="venmo-panel">
            <div id="venmo-upgrade-button-container" class="venmo-button-container"></div>

            @if (venmoLoading()) {
              <p class="payment-card__note">Loading Venmo...</p>
            } @else if (!venmoEligible()) {
              <p class="payment-card__note">
                Venmo is only available for eligible US buyers and supported devices or browsers.
              </p>
            }
          </div>
        </div>

        @if (error()) {
          <div class="payment-error" role="alert">{{ error() }}</div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .payment-page {
      min-height: 100vh;
      background: var(--color-pale-green, #EAF4DF);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
    }
    .payment-card {
      width: 100%;
      max-width: 520px;
      background: #fff;
      border: 1px solid #C8DAC2;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(74, 114, 85, 0.14);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .payment-card__back {
      width: fit-content;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-forest, #4A7255);
      text-decoration: none;
    }
    .payment-card__eyebrow {
      font-size: 0.8125rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--color-brand-green, #95C476);
      margin: 0;
    }
    .payment-card__heading {
      margin: 0;
      font-size: clamp(1.75rem, 4vw, 2.25rem);
      font-weight: 800;
      line-height: 1.15;
      color: var(--color-text-dark, #1E2D23);
    }
    .payment-card__sub,
    .payment-card__note {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--color-text-muted, #6A8272);
      line-height: 1.6;
      text-align: center;
    }
    .order-summary {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0.5rem 0;
      border-top: 1px solid #eef3eb;
      border-bottom: 1px solid #eef3eb;
    }
    .order-summary__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.8rem 0;
      border-bottom: 1px solid #f2f5f0;
    }
    .order-summary__row:last-child {
      border-bottom: none;
    }
    .order-summary__row--total {
      padding-top: 1rem;
    }
    .order-summary__label {
      font-size: 0.875rem;
      color: var(--color-text-muted, #6A8272);
    }
    .order-summary__value {
      font-size: 0.9375rem;
      font-weight: 700;
      color: var(--color-text-dark, #1E2D23);
      text-align: right;
    }
    .payment-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .payment-error {
      padding: 0.75rem 1rem;
      border-radius: 12px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: var(--color-error, #E53935);
      font-size: 0.875rem;
      font-weight: 500;
      text-align: center;
    }
    .venmo-panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
  `],
})
export class UpgradePaymentComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly paypalSdkSvc = inject(PayPalSdkService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly activeProvider = signal<'stripe' | 'paypal' | null>(null);
  readonly upgradeCampaignId = signal<string | null>(null);
  readonly venmoEligible = signal(false);
  readonly venmoLoading = signal(false);
  readonly venmoRendered = signal(false);
  private venmoRenderToken = 0;

  constructor() {
    this.upgradeCampaignId.set(this.route.snapshot.queryParamMap.get('campaignId'));
    afterNextRender(() => {
      void this.ensureVenmoButton();
    });
  }

  async startStripeCheckout(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);
    this.activeProvider.set('stripe');

    try {
      const { data: { session } } = await this.supabase.client.auth.getSession();
      if (!session) {
        await this.router.navigate(['/login']);
        return;
      }

      const origin = window.location.origin;
      const campaignId = this.upgradeCampaignId();
      this.persistPendingUpgradeCampaign(campaignId);
      const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
      const successUrl = `${origin}/pro/upgrade/success${query}`;
      const cancelUrl = `${origin}/pro/upgrade/payment${query}`;

      const { data, error } = await this.supabase.client.functions.invoke<{ url: string }>(
        'stripe-campaign-payment',
        { body: { successUrl, cancelUrl, campaignId } }
      );
      if (error) throw new Error(error.message || 'Unable to start checkout.');
      if (!data?.url) throw new Error('Checkout URL missing from response.');
      window.location.href = data.url;
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      this.loading.set(false);
      this.activeProvider.set(null);
    }
  }

  async startPayPalCheckoutFlow(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);
    this.activeProvider.set('paypal');

    try {
      const { data: { session } } = await this.supabase.client.auth.getSession();
      if (!session) {
        await this.router.navigate(['/login']);
        return;
      }

      const origin = window.location.origin;
      const campaignId = this.upgradeCampaignId();
      this.persistPendingUpgradeCampaign(campaignId);
      const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
      const data = await startPayPalCheckout(session.access_token, {
        successUrl: `${origin}/pro/upgrade/success${query}`,
        cancelUrl: `${origin}/pro/upgrade/payment${query}`,
        campaignId,
      });
      if (!data?.url) throw new Error('PayPal checkout URL missing from response.');
      window.location.href = data.url;
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      this.loading.set(false);
      this.activeProvider.set(null);
    }
  }

  async ensureVenmoButton(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.venmoRendered() || this.venmoLoading()) return;

    this.venmoLoading.set(true);
    this.error.set(null);
    const renderToken = ++this.venmoRenderToken;

    try {
      const paypal = await this.paypalSdkSvc.loadSdk();
      if (renderToken !== this.venmoRenderToken) return;

      const buttons = this.createVenmoButtons(paypal);
      this.venmoEligible.set(buttons.isEligible());

      if (!buttons.isEligible()) {
        this.venmoLoading.set(false);
        return;
      }

      const container = document.getElementById('venmo-upgrade-button-container');
      if (!container) {
        this.venmoLoading.set(false);
        return;
      }

      container.innerHTML = '';
      await buttons.render(container);
      if (renderToken !== this.venmoRenderToken) return;
      this.venmoRendered.set(true);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Failed to load Venmo.');
    } finally {
      this.venmoLoading.set(false);
    }
  }

  private createVenmoButtons(paypal: PayPalNamespace) {
    return paypal.Buttons({
      fundingSource: paypal.FUNDING.VENMO,
      style: {
        layout: 'vertical',
        color: 'blue',
        shape: 'rect',
        label: 'pay',
      },
      createOrder: async () => {
        this.error.set(null);

        const { data: { session } } = await this.supabase.client.auth.getSession();
        if (!session) {
          throw new Error('Please log in again before paying with Venmo.');
        }

        const origin = window.location.origin;
        const campaignId = this.upgradeCampaignId();
        this.persistPendingUpgradeCampaign(campaignId);
        const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
        const response = await startPayPalCheckout(session.access_token, {
          successUrl: `${origin}/pro/upgrade/success${query}`,
          cancelUrl: `${origin}/pro/upgrade/payment${query}`,
          campaignId,
        });

        if (!response?.orderId) {
          throw new Error('Venmo order ID missing from response.');
        }

        return response.orderId;
      },
      onApprove: async (data) => {
        const orderId = data.orderID;
        if (!orderId) {
          throw new Error('Venmo order ID missing after approval.');
        }

        const { data: confirmation, error } = await this.supabase.client.functions.invoke<{
          upgradedCampaignId?: string | null;
        }>('confirm-paypal-campaign-payment', {
          body: { orderId },
        });
        if (error) {
          throw new Error(error.message || 'Failed to confirm the Venmo payment.');
        }

        const upgradedCampaignId = confirmation?.upgradedCampaignId
          ? `&upgradedCampaignId=${encodeURIComponent(confirmation.upgradedCampaignId)}`
          : '';
        window.location.href = `${window.location.origin}/pro/upgrade/success?provider=venmo&confirmed=true&token=${encodeURIComponent(orderId)}${upgradedCampaignId}`;
      },
      onCancel: () => {
        this.error.set('Venmo payment was cancelled.');
      },
      onError: (error) => {
        this.error.set(error instanceof Error ? error.message : 'Venmo checkout failed.');
      },
    });
  }

  private persistPendingUpgradeCampaign(campaignId: string | null): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (campaignId) {
      window.sessionStorage.setItem(PENDING_PRO_UPGRADE_CAMPAIGN_KEY, campaignId);
    } else {
      window.sessionStorage.removeItem(PENDING_PRO_UPGRADE_CAMPAIGN_KEY);
    }
  }
}

async function startPayPalCheckout(
  accessToken: string,
  body: { successUrl: string; cancelUrl: string; campaignId: string | null },
): Promise<{ url: string; orderId?: string }> {
  const response = await fetch(`${environment.apiUrl}/paypal-campaign-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: environment.supabase.anonKey,
    },
    body: JSON.stringify(body),
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, 'Unable to start PayPal checkout.'));
  }

  return payload as { url: string; orderId?: string };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }

  return fallback;
}
