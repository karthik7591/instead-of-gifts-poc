import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';
import { Campaign, CampaignStatus } from '../models/campaign.model';
import { generateSlug, appendRandomSuffix } from '../utils/slug.util';

/** Maximum retries when a generated slug is already taken. */
const MAX_SLUG_RETRIES = 5;

export interface UpdateCampaignInput {
  title: string;
  description?: string;
  /** Optional goal in cents (frontend model). Converted to major units for DB. */
  targetAmountPence?: number | null;
  deadline?: string | null;
  customMessage?: string;
}

export interface CreateCampaignInput {
  title: string;
  description?: string;
  /** Optional goal in cents (frontend model). Converted to major units for DB. */
  targetAmountPence?: number | null;
  deadline?: string | null;     // YYYY-MM-DD or ISO string
  customMessage?: string;
  coverImageFile?: File | null;
}

/** Shape of a row returned by the campaigns table / view. */
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
  created_by: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly supabase  = inject(SupabaseService);
  private readonly toastSvc  = inject(ToastService);

  async getCampaignBySlug(slug: string): Promise<Campaign | null> {
    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // row not found — not an error
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

  /**
   * Returns `true` if `slug` is not already present in the campaigns table.
   * Only checks the exact slug — suffix variants are handled by `ensureUniqueSlug`.
   */
  async checkSlugAvailable(slug: string): Promise<boolean> {
    if (!slug) return false;

    // Select only the id column — we only care about existence, not the row data.
    const { data, error } = await this.supabase.client
      .from('campaigns')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();     // returns null (not an error) when no row is found

    if (error) {
      this.toastSvc.error('Failed to validate campaign URL.');
      throw error;
    }
    return data === null;  // null → no row found → slug is available
  }

  /**
   * Given a raw title, generates a slug and guarantees uniqueness against the
   * database. If the initial slug is taken it appends a random 4-char suffix
   * and retries up to MAX_SLUG_RETRIES times.
   *
   * @throws if uniqueness cannot be established after all retries (extremely unlikely).
   *
   * @example
   *   await ensureUniqueSlug("Alice's 30th Birthday")
   *   // first try:  "alices-30th-birthday"          (free → return)
   *   // if taken:   "alices-30th-birthday-k7qm"     (retry)
   *   // if taken:   "alices-30th-birthday-r3np"     (retry)
   */
  async ensureUniqueSlug(title: string): Promise<string> {
    const base = generateSlug(title);
    if (!base) throw new Error('Cannot generate a slug from the provided title.');

    // Try the clean slug first (no suffix)
    if (await this.checkSlugAvailable(base)) return base;

    // Retry with random suffixes
    for (let attempt = 1; attempt <= MAX_SLUG_RETRIES; attempt++) {
      const candidate = appendRandomSuffix(base);
      if (await this.checkSlugAvailable(candidate)) return candidate;
    }

    throw new Error(
      `Could not generate a unique slug for "${title}" after ${MAX_SLUG_RETRIES} attempts.`
    );
  }

  /**
   * Creates a new campaign. Slug generation and DB insert happen first so the
   * campaign gets an ID; then if a cover image was provided it is uploaded to
   * `campaign-images/[userId]/[campaignId]/cover.[ext]` and the row is updated.
   */
  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user) throw new Error('Must be authenticated to create a campaign.');

    // Persist campaign tier from the user's current subscription state.
    const { data: profile, error: profileError } = await this.supabase.client
      .from('user_profiles')
      .select('is_pro')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) {
      this.toastSvc.error('Failed to verify subscription status — please try again.');
      throw profileError;
    }
    const isProCampaign = profile?.is_pro ?? false;

    const slug = await this.ensureUniqueSlug(input.title);

    // Insert without cover image first — we need the ID for the storage path.
    const row = {
      title:           input.title.trim(),
      description:     input.description?.trim() || null,
      target_amount:   input.targetAmountPence != null
        ? input.targetAmountPence / 100   // cents → major units for DB
        : null,
      deadline:        input.deadline || null,
      custom_message:  input.customMessage?.trim() || null,
      cover_image_url: null as string | null,
      slug,
      created_by:      user.id,
      is_active:       true,
      is_pro:          isProCampaign,
    };

    const { data, error } = await this.supabase.client
      .from('campaigns')
      .insert(row)
      .select()
      .single();

    if (error) {
      this.toastSvc.error('Failed to create campaign — please try again.');
      throw error;
    }
    const created = data as CampaignRow;

    // Upload cover image now that we have the campaign ID.
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

  /**
   * Uploads a cover image to `campaign-images/[userId]/[campaignId]/cover.[ext]`
   * and returns the public CDN URL.
   */
  private async uploadCoverImage(
    userId:     string,
    campaignId: string,
    file:       File,
  ): Promise<string> {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png':  'png',
      'image/webp': 'webp',
    };
    const ext  = mimeToExt[file.type] ?? 'jpg';
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

  /**
   * Updates editable fields on an existing campaign.
   * Cover image is managed separately by ImageUploadComponent (immediate-upload mode).
   * Ownership is enforced by Supabase RLS — unauthorised calls will throw.
   */
  async updateCampaign(id: string, input: UpdateCampaignInput): Promise<void> {
    const { error } = await this.supabase.client
      .from('campaigns')
      .update({
        title:          input.title.trim(),
        description:    input.description?.trim() || null,
        target_amount:  input.targetAmountPence != null
          ? input.targetAmountPence / 100
          : null,
        deadline:       input.deadline || null,
        custom_message: input.customMessage?.trim() || null,
      })
      .eq('id', id);

    if (error) {
      this.toastSvc.error('Failed to save changes — please try again.');
      throw error;
    }
  }

  /**
   * Closes a campaign by setting is_active = false.
   * Only the campaign owner can do this (enforced by RLS).
   */
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

  /**
   * Permanently deletes a campaign owned by the current user.
   * Ownership is enforced by Supabase RLS policies.
   */
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

  /** Returns all campaigns owned by the currently authenticated user. */
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
      // target_amount is stored in major units ($); convert to cents for the model
      targetAmount: row.target_amount != null ? Math.round(row.target_amount * 100) : 0,
      amountCollected: amountCollectedPence,
      currency: 'USD',
      status,
      isPro: row.is_pro,
      customMessage: row.custom_message ?? undefined,
      organiserName: 'Organiser',  // resolved separately when profile data is available
      createdAt: row.created_at,
      endsAt: row.deadline ?? undefined,
    };
  }
}
