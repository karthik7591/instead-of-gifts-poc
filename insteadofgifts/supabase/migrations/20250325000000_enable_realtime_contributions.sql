-- Realtime: postgres_changes on public.contributions (Supabase JS client:
-- subscribeToContributions — INSERT + UPDATE with campaign_id filter).
-- REPLICA IDENTITY FULL so UPDATE payloads include old row (pending → succeeded).
alter table public.contributions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'contributions'
  ) then
    alter publication supabase_realtime add table public.contributions;
  end if;
end $$;
