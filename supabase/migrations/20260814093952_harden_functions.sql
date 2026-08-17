-- Keep trigger execution independent of caller-controlled object resolution.
alter function public.require_newer_record_version() set search_path = pg_catalog;

-- This event-trigger helper is invoked by PostgreSQL, never by API clients.
-- (rls_auto_enable is a Supabase platform default; guard for environments that may lack it.)
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public;
  end if;
end $$;
