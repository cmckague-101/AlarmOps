-- INSERT triggers run before ON CONFLICT resolves an upsert to an update.
-- Enforce vehicle ownership after conflict resolution so member updates that
-- preserve existing vehicles are accepted while unauthorized changes still roll back.
drop trigger if exists fleet_state_owner_vehicle_changes on public.fleet_state;

create trigger fleet_state_owner_vehicle_changes
after insert or update of data on public.fleet_state
for each row execute function public.enforce_owner_vehicle_changes();
