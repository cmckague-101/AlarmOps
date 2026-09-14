-- Add covering indexes for public-schema foreign keys that do not already
-- have a valid, non-partial index beginning with the foreign-key columns.
do $$
declare
  foreign_key record;
  index_name text;
  index_columns text;
  base_index_name text;
begin
  for foreign_key in
    with foreign_keys as (
      select
        constraint_record.oid as constraint_oid,
        constraint_record.conname as constraint_name,
        constraint_record.conrelid as relation_oid,
        namespace.nspname as schema_name,
        relation.relname as table_name,
        constraint_record.conkey as column_numbers,
        array_agg(attribute.attname order by key_column.ordinality) as column_names
      from pg_constraint as constraint_record
      join pg_class as relation
        on relation.oid = constraint_record.conrelid
      join pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      cross join lateral unnest(constraint_record.conkey)
        with ordinality as key_column(attribute_number, ordinality)
      join pg_attribute as attribute
        on attribute.attrelid = constraint_record.conrelid
       and attribute.attnum = key_column.attribute_number
      where constraint_record.contype = 'f'
        and namespace.nspname = 'public'
      group by
        constraint_record.oid,
        constraint_record.conname,
        constraint_record.conrelid,
        namespace.nspname,
        relation.relname,
        constraint_record.conkey
    )
    select foreign_keys.*
    from foreign_keys
    order by cardinality(foreign_keys.column_numbers) desc,
      foreign_keys.constraint_oid
  loop
    -- Recheck after each creation because one multi-column index can cover
    -- several foreign keys on the same table.
    if not exists (
      select 1
      from pg_index as index_record
      where index_record.indrelid = foreign_key.relation_oid
        and index_record.indisvalid
        and index_record.indisready
        and index_record.indpred is null
        and index_record.indnkeyatts >= cardinality(foreign_key.column_numbers)
        and not exists (
          select 1
          from unnest(foreign_key.column_numbers)
            with ordinality as foreign_key_column(attribute_number, ordinality)
          where index_record.indkey[(foreign_key_column.ordinality - 1)::integer]
            is distinct from foreign_key_column.attribute_number
        )
    ) then
      select string_agg(format('%I', column_name), ', ' order by ordinality)
      into index_columns
      from unnest(foreign_key.column_names)
        with ordinality as columns(column_name, ordinality);

      base_index_name := foreign_key.table_name
        || '_'
        || array_to_string(foreign_key.column_names, '_')
        || '_idx';

      if length(base_index_name) <= 63 then
        index_name := base_index_name;
      else
        index_name := left(base_index_name, 54)
          || '_'
          || substr(md5(base_index_name), 1, 8);
      end if;

      -- Avoid colliding with an unrelated index using the preferred name.
      if to_regclass(format('%I.%I', foreign_key.schema_name, index_name)) is not null then
        index_name := left(base_index_name, 45)
          || '_'
          || substr(md5(foreign_key.constraint_name), 1, 8)
          || '_fkey_idx';
      end if;

      execute format(
        'create index %I on %I.%I (%s)',
        index_name,
        foreign_key.schema_name,
        foreign_key.table_name,
        index_columns
      );
    end if;
  end loop;
end
$$;
