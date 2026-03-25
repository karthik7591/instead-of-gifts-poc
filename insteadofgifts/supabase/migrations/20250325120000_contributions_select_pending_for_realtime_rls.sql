-- Realtime postgres_changes on UPDATE: the subscriber must pass RLS for the old row
-- during authorization. Without this policy, pending→succeeded updates never reached
-- anonymous campaign viewers (only the new row was visible).
-- Scope matches contributions_insert_anyone: active campaign only.
-- Trade-off: pending rows on active campaigns are SELECT-visible to anon via PostgREST.

create policy "contributions_select_pending_on_active_campaigns_public"
  on public.contributions
  for select
  using (
    status = 'pending'
    and exists (
      select 1
      from public.campaigns c
      where c.id = campaign_id
        and c.is_active = true
    )
  );
