-- =============================================================================
-- Migration: full RLS policies + storage bucket for InsteadOfGifts
-- =============================================================================
-- Run order: after 20240001000000_create_campaigns_and_contributions.sql
-- RLS is already enabled on both tables; this file drops the placeholder
-- policies from the first migration and installs the definitive set.
-- =============================================================================


-- =============================================================================
-- 1. CAMPAIGNS
-- =============================================================================

-- Drop placeholder policies installed in the first migration
drop policy if exists "Public campaigns are viewable by everyone"  on public.campaigns;
drop policy if exists "Owners can view their own campaigns"         on public.campaigns;
drop policy if exists "Authenticated users can create campaigns"    on public.campaigns;
drop policy if exists "Owners can update their own campaigns"       on public.campaigns;
drop policy if exists "Owners can delete their own campaigns"       on public.campaigns;

-- ── SELECT ──────────────────────────────────────────────────────────────────

-- Anon / public: only active campaigns
create policy "campaigns_select_active_public"
  on public.campaigns
  for select
  using (is_active = true);

-- Authenticated: also see their own inactive campaigns (e.g. drafts)
create policy "campaigns_select_own_inactive"
  on public.campaigns
  for select
  to authenticated
  using (created_by = auth.uid());

-- ── INSERT ──────────────────────────────────────────────────────────────────

-- Authenticated users may create campaigns only for themselves.
-- The WITH CHECK prevents spoofing another user's id.
create policy "campaigns_insert_authenticated"
  on public.campaigns
  for insert
  to authenticated
  with check (created_by = auth.uid());

-- ── UPDATE ──────────────────────────────────────────────────────────────────

-- Only the owner may update their campaign.
-- USING filters which rows can be targeted; WITH CHECK prevents
-- changing created_by to another user mid-update.
create policy "campaigns_update_owner"
  on public.campaigns
  for update
  to authenticated
  using     (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ── DELETE ──────────────────────────────────────────────────────────────────

create policy "campaigns_delete_owner"
  on public.campaigns
  for delete
  to authenticated
  using (created_by = auth.uid());


-- =============================================================================
-- 2. CONTRIBUTIONS — base table policies
-- =============================================================================

-- Drop placeholder policies from first migration
drop policy if exists "Contributions on active campaigns are publicly viewable" on public.contributions;
drop policy if exists "Anyone can create a contribution"                         on public.contributions;

-- ── SELECT ──────────────────────────────────────────────────────────────────

-- Public: only succeeded contributions on active campaigns.
-- is_anonymous masking is handled by the view below, not at the row level,
-- because Postgres RLS is row-level, not column-level.
create policy "contributions_select_succeeded_public"
  on public.contributions
  for select
  using (
    status = 'succeeded'
    and exists (
      select 1
      from public.campaigns c
      where c.id = campaign_id
        and c.is_active = true
    )
  );

-- Campaign owners can see all contributions (including pending/failed) for
-- their own campaigns — needed for the organiser dashboard.
create policy "contributions_select_campaign_owner"
  on public.contributions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.campaigns c
      where c.id = campaign_id
        and c.created_by = auth.uid()
    )
  );

-- ── INSERT ──────────────────────────────────────────────────────────────────

-- Anyone (including anon/guest) may create a contribution.
-- Status must start as 'pending'; only the service-role webhook promotes it.
create policy "contributions_insert_anyone"
  on public.contributions
  for insert
  with check (
    status = 'pending'
    and exists (
      select 1
      from public.campaigns c
      where c.id = campaign_id
        and c.is_active = true
    )
  );

-- ── UPDATE / DELETE ──────────────────────────────────────────────────────────
-- No anon or authenticated policies are created.
-- Status transitions (pending → succeeded/failed) are performed exclusively
-- by the backend using the service_role key, which bypasses RLS entirely.


-- =============================================================================
-- 3. PUBLIC VIEW — mask contributor_name when is_anonymous = true
-- =============================================================================
-- RLS cannot redact individual columns, so we expose a security-barrier view
-- that the frontend queries instead of the raw table.
-- The SECURITY INVOKER default means the view's own RLS policies (above)
-- still apply — the view adds column-level masking on top.

create or replace view public.contributions_public
  with (security_invoker = true)   -- respects RLS of the calling role
as
select
  id,
  campaign_id,
  amount,
  message,
  is_anonymous,
  status,
  created_at,
  -- Redact contributor_name for anonymous contributions
  case
    when is_anonymous then null
    else contributor_name
  end as contributor_name
from public.contributions;

comment on view public.contributions_public is
  'Public-facing contributions view. Nulls out contributor_name when is_anonymous = true. Use this view from the frontend; never query the base table directly from client code.';


-- =============================================================================
-- 4. STORAGE — campaign-images bucket
-- =============================================================================

-- Create the bucket (idempotent via DO block)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('campaign-images', 'campaign-images', true)
  on conflict (id) do nothing;
end $$;

-- ── Public READ ──────────────────────────────────────────────────────────────

-- Anyone may download objects from this bucket (cover images are public assets).
create policy "storage_campaign_images_select_public"
  on storage.objects
  for select
  using (bucket_id = 'campaign-images');

-- ── Authenticated UPLOAD (INSERT) ────────────────────────────────────────────

-- Authenticated users may only upload inside a folder named after their own
-- user ID: campaign-images/<auth.uid()>/<filename>
-- storage.foldername(name) returns an array; index 1 is the first segment.
create policy "storage_campaign_images_insert_owner"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'campaign-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Authenticated UPDATE ─────────────────────────────────────────────────────

create policy "storage_campaign_images_update_owner"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'campaign-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Authenticated DELETE ─────────────────────────────────────────────────────

create policy "storage_campaign_images_delete_owner"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'campaign-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
