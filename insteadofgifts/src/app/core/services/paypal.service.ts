import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PayPalCheckoutParams {
  campaignId: string;
  amountPence: number;
  contributorName: string;
  message: string;
  isAnonymous: boolean;
  successUrl: string;
  cancelUrl: string;
}

interface CreatePayPalOrderResponse {
  orderId: string;
  approvalUrl: string;
}

@Injectable({ providedIn: 'root' })
export class PayPalService {
  private readonly http = inject(HttpClient);

  async createOrder(params: PayPalCheckoutParams): Promise<CreatePayPalOrderResponse> {
    try {
      return await firstValueFrom(
        this.http.post<CreatePayPalOrderResponse>(
          `${environment.apiUrl}/create-paypal-order`,
          params,
        )
      );
    } catch (error: unknown) {
      throw normalizePayPalHttpError(error, 'Unable to start PayPal checkout.');
    }
  }

  async redirectToCheckout(params: PayPalCheckoutParams): Promise<void> {
    const response = await this.createOrder(params);

    if (!response?.approvalUrl) {
      throw new Error('PayPal approval URL missing from response.');
    }

    window.location.href = response.approvalUrl;
  }
}

function normalizePayPalHttpError(error: unknown, fallback: string): Error {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return new Error(body.error);
    }

    if (typeof body === 'string' && body.trim()) {
      return new Error(body);
    }

    if (error.status === 0) {
      return new Error('Could not reach the PayPal Edge Function. Check that the function is deployed and your Supabase project allows the request.');
    }

    if (error.status === 404) {
      return new Error('PayPal Edge Function not found. Deploy `create-paypal-order` first.');
    }
  }

  return error instanceof Error ? error : new Error(fallback);
}
