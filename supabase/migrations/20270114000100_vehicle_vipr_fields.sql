-- Send to VIPR: per-unit VIPR fields in fleet_vehicles.data.
--   viprCategory  one VIPR resource category (text, set by owners)
--   engineType    NWCG engine type, 'Type 1'..'Type 7'
--   pumpGpm, pumpPsi, tankGallons, gvwrLbs  positive numbers
--   dailyRate     positive USD amount with up to 2 decimals
-- Only owners (and system admins) can change them: enforce_normalized_vehicle_changes
-- already rejects other roles for any field it does not list. The category list
-- lives in @fireops/domain (vipr.ts); the server only bounds its length so new
-- categories do not need a migration.
begin;

create or replace function public.validate_vehicle_vipr_fields()
returns trigger language plpgsql set search_path = '' as $$
declare
  field text;
  max_value numeric;
  field_value jsonb;
begin
  if new.data ? 'viprCategory'
    and (tg_op = 'INSERT' or new.data -> 'viprCategory' is distinct from old.data -> 'viprCategory')
    and (jsonb_typeof(new.data -> 'viprCategory') <> 'string'
      or char_length(btrim(new.data ->> 'viprCategory')) not between 1 and 60)
  then
    raise exception 'VIPR category must be text of 60 characters or fewer' using errcode = '22023';
  end if;
  if new.data ? 'engineType'
    and (tg_op = 'INSERT' or new.data -> 'engineType' is distinct from old.data -> 'engineType')
    and (jsonb_typeof(new.data -> 'engineType') <> 'string' or new.data ->> 'engineType' !~ '^Type [1-7]$')
  then
    raise exception 'Engine type must be Type 1 to Type 7' using errcode = '22023';
  end if;
  for field, max_value in
    select * from (values ('pumpGpm', 5000), ('pumpPsi', 1000), ('tankGallons', 20000), ('gvwrLbs', 200000), ('dailyRate', 100000)) limits
  loop
    field_value := new.data -> field;
    if field_value is not null
      and (tg_op = 'INSERT' or field_value is distinct from old.data -> field)
      and (case when jsonb_typeof(field_value) <> 'number' then true
        else field_value::numeric <= 0
          or field_value::numeric > max_value
          or field_value::numeric <> round(field_value::numeric, case when field = 'dailyRate' then 2 else 0 end)
        end)
    then
      raise exception '% must be a positive number up to %', field, max_value using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validate_vehicle_vipr_fields() from public, anon, authenticated;
create trigger fleet_vehicles_validate_vipr_fields before insert or update on public.fleet_vehicles
for each row execute function public.validate_vehicle_vipr_fields();

commit;
