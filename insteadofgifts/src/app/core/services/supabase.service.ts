import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { ToastService } from './toast.service';

export interface ContributionDisplay {
  id: string;
  contributorName: string | null;
  /** Major currency units (e.g. 12.50). Multiply by 100 for cents. */
  amount: number;
  message: string | null;
  createdAt: string;
}

export interface CampaignTotals {
  /** Sum of succeeded contributions in major currency units (e.g. 45.00). */
  total: number;
  /** Sum in smallest currency unit (cents) — matches the frontend Campaign model. */
  totalPence: number;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly toastSvc = inject(ToastService);

  readonly client: SupabaseClient = createClient(
    environment.supabase.url,
    environment.supabase.anonKey
  );

  /**
   * Fetches the sum and count of all succeeded contributions for a campaign.
   * Amounts are returned both in major units (DB decimal) and cents
   * (×100) to match the frontend Campaign model.
   */
  async getCampaignTotals(campaignId: string): Promise<CampaignTotals> {
    const { data, error } = await this.client
      .from('contributions')
      .select('amount')
      .eq('campaign_id', campaignId)
      .eq('status', 'succeeded');

    if (error) {
      this.toastSvc.error('Failed to load contribution totals.');
      throw error;
    }

    const rows = (data ?? []) as { amount: number }[];
    const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);

    return {
      total,
      totalPence: Math.round(total * 100),
      count: rows.length,
    };
  }

  /**
   * Calls the confirm-contribution Edge Function with the Stripe Checkout Session ID
   * returned in the success-URL redirect. The function verifies the payment with
   * Stripe and upserts the contribution row, making the DB update immediate rather
   * than dependent on the async webhook delivery.
   *
   * Idempotent — safe to call even if the webhook already ran.
   */
  async confirmContribution(sessionId: string): Promise<void> {
    const { error } = await this.client.functions.invoke('confirm-contribution', {
      body: { sessionId },
    });
    if (error) {
      throw error;
    }
  }

  /**
   * Fetches the most recent non-anonymous succeeded contributions for a
   * campaign from the `contributions_public` view (which nulls out names
   * when is_anonymous = true — the WHERE clause here adds a second guard).
   */
  async getContributions(
    campaignId: string,
    limit = 10
  ): Promise<ContributionDisplay[]> {
    const { data, error } = await this.client
      .from('contributions_public')
      .select('id, contributor_name, amount, message, created_at')
      .eq('campaign_id', campaignId)
      .eq('status', 'succeeded')
      .eq('is_anonymous', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.toastSvc.error('Failed to load contributions.');
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      contributorName: row.contributor_name as string | null,
      amount: Number(row.amount),
      message: row.message as string | null,
      createdAt: row.created_at as string,
    }));
  }

}
