alter table public.user_profiles
  add column if not exists campaign_pro_credits integer not null default 0
  check (campaign_pro_credits >= 0);

comment on column public.user_profiles.campaign_pro_credits is
  'Number of prepaid Campaign Pro creation credits available to the user.';

create or replace function public.create_paid_campaign(
  p_title text,
  p_slug text,
  p_description text default null,
  p_target_amount numeric default null,
  p_deadline timestamptz default null,
  p_custom_message text default null,
  p_fund_use text default null
)
returns public.campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign public.campaigns;
  v_credits integer;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated to create a campaign.';
  end if;

  select campaign_pro_credits
    into v_credits
  from public.user_profiles
  where id = v_user_id
  for update;

  if coalesce(v_credits, 0) <= 0 then
    raise exception 'Complete payment before creating a campaign.';
  end if;

  insert into public.campaigns (
    title,
    slug,
    description,
    target_amount,
    deadline,
    custom_message,
    fund_use,
    created_by,
    is_active,
    is_pro
  ) values (
    trim(p_title),
    trim(p_slug),
    nullif(trim(coalesce(p_description, '')), ''),
    p_target_amount,
    p_deadline,
    nullif(trim(coalesce(p_custom_message, '')), ''),
    nullif(trim(coalesce(p_fund_use, '')), ''),
    v_user_id,
    true,
    true
  )
  returning * into v_campaign;

  update public.user_profiles
  set campaign_pro_credits = campaign_pro_credits - 1
  where id = v_user_id;

  return v_campaign;
end;
$$;

grant execute on function public.create_paid_campaign(text, text, text, numeric, timestamptz, text, text) to authenticated;
