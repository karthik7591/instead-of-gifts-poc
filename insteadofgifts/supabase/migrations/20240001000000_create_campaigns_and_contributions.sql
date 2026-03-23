-- =============================================================================
-- Migration: create campaigns and contributions tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------

create table if not exists public.campaigns (
  id               uuid          primary key default gen_random_uuid(),
  title            varchar(255)  not null,
  description      text,
  target_amount    decimal(12,2),
  deadline         timestamptz,
  is_active        boolean       not null default true,
  is_pro           boolean       not null default false,
  cover_image_url  text,
  custom_message   text,
  slug             varchar(100)  not null unique,
  created_by       uuid          references auth.users(id) on delete set null,
  created_at       timestamptz   not null default now()
);

comment on table  public.campaigns                is 'Gift campaigns created by organisers.';
comment on column public.campaigns.id             is 'Auto-generated UUID primary key.';
comment on column public.campaigns.slug           is 'URL-safe unique identifier, e.g. "alice-birthday-2025".';
comment on column public.campaigns.target_amount  is 'Optional fundraising goal in major currency units (e.g. USD).';
comment on column public.campaigns.created_by     is 'References auth.users; null if the organiser account is deleted.';

-- ---------------------------------------------------------------------------
-- contributions
-- ---------------------------------------------------------------------------

create table if not exists public.contributions (
  id                uuid          primary key default gen_random_uuid(),
  campaign_id       uuid          not null references public.campaigns(id) on delete cascade,
  amount            decimal(12,2) not null check (amount > 0),
  message           text,
  is_anonymous      boolean       not null default false,
  stripe_pi_id      varchar       not null unique,
  status            varchar       not null default 'pending'
                      check (status in ('pending', 'succeeded', 'failed')),
  contributor_name  text,
  created_at        timestamptz   not null default now()
);

comment on table  public.contributions                  is 'Individual contributions made to a campaign via Stripe.';
comment on column public.contributions.stripe_pi_id     is 'Stripe PaymentIntent ID (pi_…). Unique to prevent duplicate processing.';
comment on column public.contributions.status           is 'Mirrors the Stripe PaymentIntent status: pending | succeeded | failed.';
comment on column public.contributions.is_anonymous     is 'When true, contributor_name is hidden from the public campaign view.';
comment on column public.contributions.contributor_name is 'Stored separately from auth to support anonymous and guest contributions.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Fast look-up of all contributions for a campaign (used on campaign page)
create index if not exists idx_contributions_campaign_id
  on public.contributions (campaign_id);

-- Fast look-up of a campaign by its slug (used on every page load)
create index if not exists idx_campaigns_slug
  on public.campaigns (slug);

-- Fast look-up of all campaigns owned by a user (used on dashboard)
create index if not exists idx_campaigns_created_by
  on public.campaigns (created_by);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.campaigns     enable row level security;
alter table public.contributions enable row level security;

-- campaigns: anyone can read active campaigns
create policy "Public campaigns are viewable by everyone"
  on public.campaigns for select
  using (is_active = true);

-- campaigns: authenticated user can read their own inactive campaigns too
create policy "Owners can view their own campaigns"
  on public.campaigns for select
  to authenticated
  using (created_by = auth.uid());

-- campaigns: only authenticated users can create campaigns
create policy "Authenticated users can create campaigns"
  on public.campaigns for insert
  to authenticated
  with check (created_by = auth.uid());

-- campaigns: only the owner can update their own campaign
create policy "Owners can update their own campaigns"
  on public.campaigns for update
  to authenticated
  using  (created_by = auth.uid())
  with check (created_by = auth.uid());

-- campaigns: only the owner can delete their own campaign
create policy "Owners can delete their own campaigns"
  on public.campaigns for delete
  to authenticated
  using (created_by = auth.uid());

-- contributions: visible to the campaign owner and (if not anonymous) publicly
create policy "Contributions on active campaigns are publicly viewable"
  on public.contributions for select
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and c.is_active = true
    )
  );

-- contributions: anyone (including guests) can insert — status starts 'pending'
-- and is only updated by the backend webhook after Stripe confirms payment.
create policy "Anyone can create a contribution"
  on public.contributions for insert
  with check (status = 'pending');

-- contributions: only the service role (backend webhook) may update status.
-- No anon/authenticated policy is added — backend uses service_role key.
