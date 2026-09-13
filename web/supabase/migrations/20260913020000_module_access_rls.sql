-- Module-level access is the boundary between the private application and its
-- future libraries. This migration intentionally protects the existing Courses
-- module only; movies and series receive no content schema in this step.

begin;

create type public.library_module as enum ('courses', 'movies', 'series');

create table public.user_module_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module public.library_module not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, module)
);

create index user_module_access_module_user_idx
  on public.user_module_access(module, user_id);

alter table public.user_module_access enable row level security;

create or replace function public.has_module_access(p_module public.library_module)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_authorized_user()
    and exists (
      select 1
      from public.user_module_access access
      where access.user_id = auth.uid()
        and access.module = p_module
    );
$$;

revoke all on function public.has_module_access(public.library_module) from public;
grant execute on function public.has_module_access(public.library_module) to authenticated;

create or replace function public.get_my_module_access()
returns table (module public.library_module)
language sql
stable
security definer
set search_path = public
as $$
  select access.module
  from public.user_module_access access
  where access.user_id = auth.uid()
    and public.is_authorized_user()
  order by access.module;
$$;

revoke all on function public.get_my_module_access() from public;
grant execute on function public.get_my_module_access() to authenticated;

-- Existing authorised accounts retain their Courses access. New accounts are
-- deliberately not granted a module by the profile-creation trigger.
insert into public.user_module_access (user_id, module)
select profile.id, 'courses'::public.library_module
from public.profiles profile
where profile.is_authorized
on conflict (user_id, module) do nothing;

create policy "Admins manage module access"
on public.user_module_access
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Replace broad authorised-user reads with the Courses module boundary.
drop policy if exists "Authorized users can read library sources" on public.library_sources;
drop policy if exists "Authorized users can read drive items" on public.drive_items;
drop policy if exists "Authorized users can read categories" on public.categories;
drop policy if exists "Authorized users can read courses" on public.courses;
drop policy if exists "Authorized users can read course sections" on public.course_sections;
drop policy if exists "Authorized users can read lessons" on public.lessons;
drop policy if exists "Authorized users can read sync runs" on public.catalog_sync_runs;
drop policy if exists "Authorized users can read course resources" on public.course_resources;

create policy "Course members can read library sources" on public.library_sources for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read drive items" on public.drive_items for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read categories" on public.categories for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read courses" on public.courses for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read course sections" on public.course_sections for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read lessons" on public.lessons for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read sync runs" on public.catalog_sync_runs for select to authenticated using (public.has_module_access('courses'));
create policy "Course members can read course resources" on public.course_resources for select to authenticated using (public.has_module_access('courses'));

-- An administrator may maintain course metadata, but cannot use the broad
-- management policy as an implicit read/consumption grant.
drop policy if exists "Admins manage library sources" on public.library_sources;
drop policy if exists "Admins manage drive items" on public.drive_items;
drop policy if exists "Admins manage categories" on public.categories;
drop policy if exists "Admins manage courses" on public.courses;
drop policy if exists "Admins manage course sections" on public.course_sections;
drop policy if exists "Admins manage lessons" on public.lessons;
drop policy if exists "Admins manage sync runs" on public.catalog_sync_runs;
drop policy if exists "Admins manage course resources" on public.course_resources;

create policy "Admins insert library sources" on public.library_sources for insert to authenticated with check (public.is_admin());
create policy "Admins update library sources" on public.library_sources for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete library sources" on public.library_sources for delete to authenticated using (public.is_admin());
create policy "Admins insert drive items" on public.drive_items for insert to authenticated with check (public.is_admin());
create policy "Admins update drive items" on public.drive_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete drive items" on public.drive_items for delete to authenticated using (public.is_admin());
create policy "Admins insert categories" on public.categories for insert to authenticated with check (public.is_admin());
create policy "Admins update categories" on public.categories for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete categories" on public.categories for delete to authenticated using (public.is_admin());
create policy "Admins insert courses" on public.courses for insert to authenticated with check (public.is_admin());
create policy "Admins update courses" on public.courses for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete courses" on public.courses for delete to authenticated using (public.is_admin());
create policy "Admins insert course sections" on public.course_sections for insert to authenticated with check (public.is_admin());
create policy "Admins update course sections" on public.course_sections for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete course sections" on public.course_sections for delete to authenticated using (public.is_admin());
create policy "Admins insert lessons" on public.lessons for insert to authenticated with check (public.is_admin());
create policy "Admins update lessons" on public.lessons for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete lessons" on public.lessons for delete to authenticated using (public.is_admin());
create policy "Admins insert sync runs" on public.catalog_sync_runs for insert to authenticated with check (public.is_admin());
create policy "Admins update sync runs" on public.catalog_sync_runs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete sync runs" on public.catalog_sync_runs for delete to authenticated using (public.is_admin());
create policy "Admins insert course resources" on public.course_resources for insert to authenticated with check (public.is_admin());
create policy "Admins update course resources" on public.course_resources for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete course resources" on public.course_resources for delete to authenticated using (public.is_admin());

drop policy if exists "Users manage their own progress" on public.lesson_progress;
drop policy if exists "Users manage their own notes" on public.lesson_notes;

create policy "Course members manage their own progress"
on public.lesson_progress
for all
to authenticated
using (user_id = auth.uid() and public.has_module_access('courses'))
with check (user_id = auth.uid() and public.has_module_access('courses'));

create policy "Course members manage their own notes"
on public.lesson_notes
for all
to authenticated
using (user_id = auth.uid() and public.has_module_access('courses'))
with check (user_id = auth.uid() and public.has_module_access('courses'));

notify pgrst, 'reload schema';

commit;
