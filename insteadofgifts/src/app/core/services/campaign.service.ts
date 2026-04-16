import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';
import { Campaign, CampaignFundUse, CampaignStatus } from '../models/campaign.model';
import { appendRandomSuffix, generateSlug } from '../utils/slug.util';

const MAX_SLUG_RETRIES = 5;

export interface UpdateCampaignInput {
  title: string;
  description?: string;
  targetAmountPence?: number | null;
  deadline?: string | null;
  customMessage?: string;
  fundUse?: CampaignFundUse | null;
}

export interface CreateCampaignInput {
  title: string;
  description?: string;
  targetAmountPence?: number | null;
  deadline?: string | null;
  customMessage?: string;
  coverImageFile?: File | null;
  fundUse?: CampaignFundUse | null;
  usePaidCredit?: boolean;
}

interface CampaignRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  target_amount: number | null;
  deadline: string | null;
  is_active: boolean;
  is_pro: boolean;
  cover_image_url: string | null;
  custom_message: string | null;
  fund_use: CampaignFundUse | null;
  created_by: string | null;
  created_at: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
}

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly supabase = inject(SupabaseService);
  private readonly toastSvc = inject(ToastService);

  async getCampaignBySlug(slug: string): Promise<Campaign | null> {
    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      this.toastSvc.error('Failed to load the campaign.');
      throw error;
    }
    return this.toModel(data as CampaignRow, 0);
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      this.toastSvc.error('Failed to load the campaign.');
      throw error;
    }
    return this.toModel(data as CampaignRow, 0);
  }

  async checkSlugAvailable(slug: string): Promise<boolean> {
    if (!slug) return false;

    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      this.toastSvc.error('Failed to validate campaign URL.');
      throw error;
    }
    return data === null;
  }

  async ensureUniqueSlug(title: string): Promise<string> {
    const base = generateSlug(title);
    if (!base) throw new Error('Cannot generate a slug from the provided title.');

    if (await this.checkSlugAvailable(base)) return base;

    for (let attempt = 1; attempt <= MAX_SLUG_RETRIES; attempt++) {
      const candidate = appendRandomSuffix(base);
      if (await this.checkSlugAvailable(candidate)) return candidate;
    }

    throw new Error(`Could not generate a unique slug for "${title}" after ${MAX_SLUG_RETRIES} attempts.`);
  }

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user) throw new Error('Must be authenticated to create a campaign.');

    const slug = await this.ensureUniqueSlug(input.title);

    const usePaidCredit = input.usePaidCredit === true;

    let data: unknown;
    let error: unknown;

    if (usePaidCredit) {
      const response = await this.supabase.client.rpc('create_paid_campaign', {
        p_title: input.title.trim(),
        p_slug: slug,
        p_description: input.description?.trim() || null,
        p_target_amount: input.targetAmountPence != null ? input.targetAmountPence / 100 : null,
        p_deadline: input.deadline || null,
        p_custom_message: input.customMessage?.trim() || null,
        p_fund_use: input.fundUse ?? null,
      });
      data = response.data;
      error = response.error;
    } else {
      const response = await this.supabase.client
        .from('campaigns')
        .insert({
          title: input.title.trim(),
          slug,
          description: input.description?.trim() || null,
          target_amount: input.targetAmountPence != null ? input.targetAmountPence / 100 : null,
          deadline: input.deadline || null,
          custom_message: input.customMessage?.trim() || null,
          fund_use: input.fundUse ?? null,
          created_by: user.id,
          is_active: true,
          is_pro: false,
        })
        .select('*')
        .single();
      data = response.data;
      error = response.error;
    }

    if (error) {
      const err = error as { message?: string };
      this.toastSvc.error(err.message || 'Failed to create campaign.');
      throw error;
    }

    const created = data as CampaignRow;

    if (input.coverImageFile) {
      const cdnUrl = await this.uploadCoverImage(user.id, created.id, input.coverImageFile);
      const { error: updateErr } = await this.supabase.client
        .from('campaigns')
        .update({ cover_image_url: cdnUrl })
        .eq('id', created.id);
      if (updateErr) {
        this.toastSvc.warning('Campaign created, but the cover image could not be saved.');
        throw updateErr;
      }
      created.cover_image_url = cdnUrl;
    }

    return this.toModel(created, 0);
  }

  async upgradeCampaignWithCredit(id: string): Promise<Campaign> {
    const { data, error } = await this.supabase.client
      .rpc('upgrade_paid_campaign', { p_campaign_id: id })
      .single();

    if (error) {
      this.toastSvc.error(error.message || 'Failed to upgrade campaign.');
      throw error;
    }

    return this.toModel(data as CampaignRow, 0);
  }

  private async uploadCoverImage(userId: string, campaignId: string, file: File): Promise<string> {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = mimeToExt[file.type] ?? 'jpg';
    const path = `${userId}/${campaignId}/cover.${ext}`;

    const { error } = await this.supabase.client.storage
      .from('campaign-images')
      .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '31536000' });

    if (error) {
      this.toastSvc.error('Cover image upload failed — please try again.');
      throw error;
    }

    const { data } = this.supabase.client.storage
      .from('campaign-images')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async updateCampaign(id: string, input: UpdateCampaignInput): Promise<void> {
    const { error } = await this.supabase.client
      .from('campaigns')
      .update({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        target_amount: input.targetAmountPence != null ? input.targetAmountPence / 100 : null,
        deadline: input.deadline || null,
        custom_message: input.customMessage?.trim() || null,
        fund_use: input.fundUse ?? null,
      })
      .eq('id', id);

    if (error) {
      this.toastSvc.error('Failed to save changes — please try again.');
      throw error;
    }
  }

  async closeCampaign(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('campaigns')
      .update({ is_active: false })
      .eq('id', id);

    if (error) {
      this.toastSvc.error('Failed to close the campaign — please try again.');
      throw error;
    }
  }

  async deleteCampaign(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) {
      this.toastSvc.error('Failed to delete the campaign — please try again.');
      throw error;
    }
  }

  async getOwnCampaigns(): Promise<Campaign[]> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user) return [];

    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      this.toastSvc.error('Failed to load your campaigns — please refresh.');
      throw error;
    }
    return (data as CampaignRow[]).map((row) => this.toModel(row, 0));
  }

  async getActiveCampaigns(): Promise<Campaign[]> {
    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.toastSvc.error('Failed to load active campaigns.');
      throw error;
    }

    return (data as CampaignRow[]).map((row) => this.toModel(row, 0));
  }

  private toModel(row: CampaignRow, amountCollectedPence: number): Campaign {
    let status: CampaignStatus = 'active';
    if (!row.is_active) {
      status = 'closed';
    } else {
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (ageMs < 48 * 60 * 60 * 1000) status = 'new';
    }

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description ?? '',
      coverImageUrl: row.cover_image_url ?? undefined,
      targetAmount: row.target_amount != null ? Math.round(row.target_amount * 100) : 0,
      amountCollected: amountCollectedPence,
      currency: 'USD',
      status,
      isPro: row.is_pro,
      customMessage: row.custom_message ?? undefined,
      fundUse: row.fund_use ?? undefined,
      organiserName: 'Organiser',
      createdAt: row.created_at,
      endsAt: row.deadline ?? undefined,
      stripeAccountId: row.stripe_account_id ?? null,
      stripeOnboardingComplete: row.stripe_onboarding_complete ?? false,
    };
  }
}
