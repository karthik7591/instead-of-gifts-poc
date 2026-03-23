import { Injectable, inject } from '@angular/core';
import {
  createClient,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient,
} from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { ToastService } from './toast.service';

export interface ContributionRow {
  id: string;
  campaign_id: string;
  amount: number;         // major currency units as stored in DB (e.g. 45.00 USD)
  message: string | null;
  is_anonymous: boolean;
  contributor_name: string | null;
  stripe_pi_id: string;
  status: 'pending' | 'succeeded' | 'failed';
  created_at: string;
}

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

  /**
   * Subscribes to succeeded contributions for a campaign via Supabase Realtime.
   * Listens for both INSERT (direct succeeded rows) and UPDATE (pending→succeeded
   * transitions written by the webhook). Filters at the channel level by
   * campaign_id; status is checked in the callback.
   *
   * @returns Unsubscribe function — call it in ngOnDestroy / DestroyRef.
   */
  subscribeToContributions(
    campaignId: string,
    callback: (payload: RealtimePostgresInsertPayload<ContributionRow> | RealtimePostgresUpdatePayload<ContributionRow>) => void
  ): () => void {
    const channelName = `contributions:campaign_id=eq.${campaignId}`;
    const filter = { schema: 'public', table: 'contributions', filter: `campaign_id=eq.${campaignId}` };

    const channel = this.client
      .channel(channelName)
      .on<ContributionRow>(
        'postgres_changes',
        { event: 'INSERT', ...filter },
        (payload) => {
          if (payload.new.status === 'succeeded') { callback(payload); }
        }
      )
      .on<ContributionRow>(
        'postgres_changes',
        { event: 'UPDATE', ...filter },
        (payload) => {
          // Only fire when a row transitions TO succeeded (e.g. pending → succeeded via webhook).
          if (payload.new.status === 'succeeded' && payload.old?.status !== 'succeeded') {
            callback(payload as unknown as RealtimePostgresInsertPayload<ContributionRow>);
          }
        }
      )
      .subscribe();

    return () => {
      this.client.removeChannel(channel);
    };
  }
}
