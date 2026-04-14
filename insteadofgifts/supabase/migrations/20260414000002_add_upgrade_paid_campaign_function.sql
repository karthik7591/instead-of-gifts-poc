create or replace function public.upgrade_paid_campaign(
  p_campaign_id uuid
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
    raise exception 'Must be authenticated to upgrade a campaign.';
  end if;

  select *
    into v_campaign
  from public.campaigns
  where id = p_campaign_id
    and created_by = v_user_id
  for update;

  if not found then
    raise exception 'Campaign not found or you do not have access.';
  end if;

  if v_campaign.is_pro then
    return v_campaign;
  end if;

  select campaign_pro_credits
    into v_credits
  from public.user_profiles
  where id = v_user_id
  for update;

  if coalesce(v_credits, 0) <= 0 then
    raise exception 'Complete payment before upgrading this campaign.';
  end if;

  update public.campaigns
  set is_pro = true
  where id = p_campaign_id
  returning * into v_campaign;

  update public.user_profiles
  set campaign_pro_credits = campaign_pro_credits - 1
  where id = v_user_id;

  return v_campaign;
end;
$$;

grant execute on function public.upgrade_paid_campaign(uuid) to authenticated;
