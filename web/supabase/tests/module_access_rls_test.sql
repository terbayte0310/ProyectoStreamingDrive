-- Run in the Supabase SQL Editor after the module-access migration.
-- It uses one existing authorised account, removes its Courses grant only inside
-- this transaction, and rolls everything back at the end.

begin;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', id::text, true)
from public.profiles
where is_authorized
order by created_at
limit 1;

do $$
declare
  v_user_id uuid;
  v_course_count bigint;
begin
  select id into v_user_id
  from public.profiles
  where is_authorized
  order by created_at
  limit 1;

  if v_user_id is null then
    raise exception 'An authorised profile is required for this test';
  end if;

  if not public.has_module_access('courses') then
    raise exception 'Existing authorised accounts must receive Courses access';
  end if;

  select count(*) into v_course_count from public.courses;
  if v_course_count = 0 then
    raise exception 'The test requires at least one imported course';
  end if;

  -- This setup runs as the SQL Editor owner, before assuming an end-user role.
  -- It allows the test to work with an authorised reader as well as an admin.
  delete from public.user_module_access
  where user_id = v_user_id and module = 'courses';
end;
$$;

set local role authenticated;

do $$
begin
  if public.has_module_access('courses') then
    raise exception 'Removed Courses access is still reported as granted';
  end if;

  if exists (select 1 from public.courses) then
    raise exception 'A user without Courses access can still read courses';
  end if;

  if exists (select 1 from public.lessons) then
    raise exception 'A user without Courses access can still read lessons';
  end if;

  if exists (select 1 from public.course_resources) then
    raise exception 'A user without Courses access can still read resources';
  end if;

  if exists (select 1 from public.get_catalog_home()) then
    raise exception 'A user without Courses access can still read the catalog RPC';
  end if;
end;
$$;

rollback;
