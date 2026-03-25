-- =============================================================================
-- Migration: add fund_use to campaigns
-- =============================================================================

alter table public.campaigns
  add column if not exists fund_use text
  check (fund_use in ('educational', 'personal'));

comment on column public.campaigns.fund_use
  is 'Optional campaign purpose selected by organiser: educational or personal.';
