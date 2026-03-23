import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

interface PaymentIntentResponse {
  clientSecret: string;
}

interface CreatePaymentSessionPayload {
  campaignId: string;
  amount: number;
  message: string;
}

export interface CheckoutParams {
  campaignId: string;
  /** Amount in pence / cents (smallest currency unit). */
  amountPence: number;
  contributorName: string;
  message: string;
  isAnonymous: boolean;
  successUrl: string;
  cancelUrl: string;
}

interface CheckoutSessionResponse {
  url: string;
}

@Injectable({ providedIn: 'root' })
export class StripeService {
  private readonly http = inject(HttpClient);

  /** Lazily loaded Stripe instance — resolves once on first call, reused thereafter. */
  private stripePromise: Promise<Stripe | null> | null = null;

  getStripe(): Promise<Stripe | null> {
    if (!this.stripePromise) {
      this.stripePromise = loadStripe(environment.stripe.publishableKey);
    }
    return this.stripePromise;
  }

  /**
   * Creates a Stripe Checkout Session via the backend and redirects the
   * browser to the hosted Stripe payment page.
   *
   * The backend endpoint POST /payments/create-checkout-session must return
   * { url: string } — the Stripe-hosted Checkout URL.
   *
   * On payment success, Stripe redirects to `params.successUrl`.
   * On cancellation, Stripe redirects to `params.cancelUrl`.
   */
  async redirectToCheckout(params: CheckoutParams): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<CheckoutSessionResponse>(
        `${environment.apiUrl}/create-checkout-session`,
        params
      )
    );
    // Hard-navigate to Stripe's hosted Checkout page
    window.location.href = response.url;
  }

  /**
   * Calls the backend to create a Stripe Payment Intent and returns its client secret.
   * @param campaignId  The campaign receiving the contribution.
   * @param amount      Amount in the smallest currency unit (e.g. pence / cents).
   * @param message     Optional donor message attached to the payment metadata.
   */
  async createPaymentSession(
    campaignId: string,
    amount: number,
    message: string
  ): Promise<string> {
    const payload: CreatePaymentSessionPayload = { campaignId, amount, message };
    const response = await firstValueFrom(
      this.http.post<PaymentIntentResponse>(
        `${environment.apiUrl}/payments/create-intent`,
        payload
      )
    );
    return response.clientSecret;
  }
}
