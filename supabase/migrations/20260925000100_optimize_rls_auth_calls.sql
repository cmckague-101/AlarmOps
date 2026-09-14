-- Cache auth.uid() as an init plan instead of evaluating it once for every
-- row considered by each RLS policy.
do $$
declare
  policy_record record;
  using_expression text;
  check_expression text;
  optimized_using_expression text;
  optimized_check_expression text;
begin
  for policy_record in
    select
      policy.oid,
      policy.polname as policy_name,
      namespace.nspname as schema_name,
      relation.relname as table_name,
      policy.polrelid,
      policy.polqual,
      policy.polwithcheck
    from pg_policy as policy
    join pg_class as relation on relation.oid = policy.polrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'storage')
  loop
    using_expression := pg_get_expr(
      policy_record.polqual,
      policy_record.polrelid
    );
    check_expression := pg_get_expr(
      policy_record.polwithcheck,
      policy_record.polrelid
    );

    optimized_using_expression := using_expression;
    optimized_check_expression := check_expression;

    -- Expressions already containing an auth init plan need no rewrite.
    if using_expression is not null
      and using_expression !~* 'select[[:space:]]+auth[.]uid[(][)]' then
      optimized_using_expression := replace(
        using_expression,
        'auth.uid()',
        '(select auth.uid())'
      );
    end if;

    if check_expression is not null
      and check_expression !~* 'select[[:space:]]+auth[.]uid[(][)]' then
      optimized_check_expression := replace(
        check_expression,
        'auth.uid()',
        '(select auth.uid())'
      );
    end if;

    if optimized_using_expression is distinct from using_expression
      or optimized_check_expression is distinct from check_expression then
      execute format(
        'alter policy %I on %I.%I%s%s',
        policy_record.policy_name,
        policy_record.schema_name,
        policy_record.table_name,
        case
          when optimized_using_expression is not null
            then format(' using (%s)', optimized_using_expression)
          else ''
        end,
        case
          when optimized_check_expression is not null
            then format(' with check (%s)', optimized_check_expression)
          else ''
        end
      );
    end if;
  end loop;
end
$$;
