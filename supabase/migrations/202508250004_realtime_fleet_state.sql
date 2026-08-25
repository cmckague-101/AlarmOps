-- Broadcast company fleet changes to connected clients. Row-level security still
-- limits each subscriber to fleet_state rows they may select.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fleet_state'
  ) then
    alter publication supabase_realtime add table public.fleet_state;
  end if;
end
$$;
