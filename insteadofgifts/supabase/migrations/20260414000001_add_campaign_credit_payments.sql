create table if not exists public.campaign_credit_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payment_provider text not null,
  payment_reference text not null,
  granted_credits integer not null default 1 check (granted_credits > 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (payment_provider, payment_reference)
);

comment on table public.campaign_credit_payments is
  'Idempotency ledger for one-time campaign credit payments confirmed via payment providers.';

comment on column public.campaign_credit_payments.payment_provider is
  'Payment processor used for the campaign credit purchase, e.g. stripe or paypal.';

comment on column public.campaign_credit_payments.payment_reference is
  'Provider-specific unique payment reference used to prevent granting duplicate credits.';

create or replace function public.grant_campaign_credit_if_unprocessed(
  p_user_id uuid,
  p_payment_provider text,
  p_payment_reference text,
  p_granted_credits integer default 1,
  p_pro_payment_provider text default null,
  p_pro_since timestamptz default timezone('utc', now())
)
returns table (
  applied boolean,
  campaign_pro_credits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  next_credits integer := 0;
begin
  if p_granted_credits is null or p_granted_credits < 1 then
    raise exception 'p_granted_credits must be at least 1';
  end if;

  insert into public.campaign_credit_payments (
    user_id,
    payment_provider,
    payment_reference,
    granted_credits
  )
  values (
    p_user_id,
    p_payment_provider,
    p_payment_reference,
    p_granted_credits
  )
  on conflict (payment_provider, payment_reference) do nothing;

  get diagnostics inserted_count = row_count;

  insert into public.user_profiles (
    id,
    campaign_pro_credits,
    pro_payment_provider,
    pro_since
  )
  values (
    p_user_id,
    case when inserted_count = 1 then p_granted_credits else 0 end,
    case when inserted_count = 1 then coalesce(p_pro_payment_provider, p_payment_provider) else null end,
    case when inserted_count = 1 then p_pro_since else null end
  )
  on conflict (id) do update
  set
    campaign_pro_credits = public.user_profiles.campaign_pro_credits
      + case when inserted_count = 1 then p_granted_credits else 0 end,
    pro_payment_provider = case
      when inserted_count = 1 then coalesce(p_pro_payment_provider, p_payment_provider)
      else public.user_profiles.pro_payment_provider
    end,
    pro_since = case
      when inserted_count = 1 then p_pro_since
      else public.user_profiles.pro_since
    end
  returning public.user_profiles.campaign_pro_credits into next_credits;

  return query select inserted_count = 1, next_credits;
end;
$$;

revoke all on function public.grant_campaign_credit_if_unprocessed(
  uuid, text, text, integer, text, timestamptz
) from public;
grant execute on function public.grant_campaign_credit_if_unprocessed(
  uuid, text, text, integer, text, timestamptz
) to service_role;
