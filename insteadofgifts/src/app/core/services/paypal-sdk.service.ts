import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

export interface PayPalButtonsConfig {
  fundingSource?: string;
  style?: Record<string, unknown>;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID?: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
}

export interface PayPalButtonsInstance {
  isEligible(): boolean;
  render(container: string | HTMLElement): Promise<void>;
}

export interface PayPalNamespace {
  FUNDING: {
    PAYPAL: string;
    VENMO: string;
  };
  Buttons(config: PayPalButtonsConfig): PayPalButtonsInstance;
}

@Injectable({ providedIn: 'root' })
export class PayPalSdkService {
  private readonly document = inject(DOCUMENT);
  private scriptPromise: Promise<PayPalNamespace> | null = null;

  loadSdk(): Promise<PayPalNamespace> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('PayPal SDK can only load in the browser.'));
    }

    if (window.paypal) {
      return Promise.resolve(window.paypal);
    }

    if (!this.scriptPromise) {
      this.scriptPromise = new Promise<PayPalNamespace>((resolve, reject) => {
        const existing = this.document.getElementById('paypal-js-sdk') as HTMLScriptElement | null;
        if (existing) {
          existing.addEventListener('load', () => window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK failed to initialize.')));
          existing.addEventListener('error', () => reject(new Error('Failed to load PayPal SDK.')));
          return;
        }

        const script = this.document.createElement('script');
        script.id = 'paypal-js-sdk';
        script.src = this.buildSdkUrl();
        script.async = true;
        script.onload = () => {
          if (window.paypal) {
            resolve(window.paypal);
          } else {
            reject(new Error('PayPal SDK failed to initialize.'));
          }
        };
        script.onerror = () => reject(new Error('Failed to load PayPal SDK.'));
        this.document.head.appendChild(script);
      });
    }

    return this.scriptPromise;
  }

  private buildSdkUrl(): string {
    const params = new URLSearchParams({
      'client-id': environment.paypal.clientId,
      currency: 'USD',
      intent: 'capture',
      components: 'buttons',
      'enable-funding': 'venmo',
    });

    if (environment.paypal.environment === 'sandbox') {
      params.set('buyer-country', 'US');
    }

    return `https://www.paypal.com/sdk/js?${params.toString()}`;
  }
}
