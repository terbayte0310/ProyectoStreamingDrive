-- Reverses 20260913020000_module_access_rls.sql only. Run manually in the
-- Supabase SQL Editor if the module-access rollout must be undone.

begin;

drop policy if exists "Course members can read library sources" on public.library_sources;
drop policy if exists "Course members can read drive items" on public.drive_items;
drop policy if exists "Course members can read categories" on public.categories;
drop policy if exists "Course members can read courses" on public.courses;
drop policy if exists "Course members can read course sections" on public.course_sections;
drop policy if exists "Course members can read lessons" on public.lessons;
drop policy if exists "Course members can read sync runs" on public.catalog_sync_runs;
drop policy if exists "Course members can read course resources" on public.course_resources;
drop policy if exists "Course members manage their own progress" on public.lesson_progress;
drop policy if exists "Course members manage their own notes" on public.lesson_notes;

drop policy if exists "Admins insert library sources" on public.library_sources;
drop policy if exists "Admins update library sources" on public.library_sources;
drop policy if exists "Admins delete library sources" on public.library_sources;
drop policy if exists "Admins insert drive items" on public.drive_items;
drop policy if exists "Admins update drive items" on public.drive_items;
drop policy if exists "Admins delete drive items" on public.drive_items;
drop policy if exists "Admins insert categories" on public.categories;
drop policy if exists "Admins update categories" on public.categories;
drop policy if exists "Admins delete categories" on public.categories;
drop policy if exists "Admins insert courses" on public.courses;
drop policy if exists "Admins update courses" on public.courses;
drop policy if exists "Admins delete courses" on public.courses;
drop policy if exists "Admins insert course sections" on public.course_sections;
drop policy if exists "Admins update course sections" on public.course_sections;
drop policy if exists "Admins delete course sections" on public.course_sections;
drop policy if exists "Admins insert lessons" on public.lessons;
drop policy if exists "Admins update lessons" on public.lessons;
drop policy if exists "Admins delete lessons" on public.lessons;
drop policy if exists "Admins insert sync runs" on public.catalog_sync_runs;
drop policy if exists "Admins update sync runs" on public.catalog_sync_runs;
drop policy if exists "Admins delete sync runs" on public.catalog_sync_runs;
drop policy if exists "Admins insert course resources" on public.course_resources;
drop policy if exists "Admins update course resources" on public.course_resources;
drop policy if exists "Admins delete course resources" on public.course_resources;

drop policy if exists "Admins manage module access" on public.user_module_access;
drop function if exists public.get_my_module_access();
drop function if exists public.has_module_access(public.library_module);
drop table public.user_module_access;
drop type public.library_module;

create policy "Authorized users can read library sources" on public.library_sources for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read drive items" on public.drive_items for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read categories" on public.categories for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read courses" on public.courses for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read course sections" on public.course_sections for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read lessons" on public.lessons for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read sync runs" on public.catalog_sync_runs for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read course resources" on public.course_resources for select to authenticated using (public.is_authorized_user());

create policy "Admins manage library sources" on public.library_sources for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage drive items" on public.drive_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage courses" on public.courses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage course sections" on public.course_sections for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage lessons" on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage sync runs" on public.catalog_sync_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage course resources" on public.course_resources for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Users manage their own progress" on public.lesson_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their own notes" on public.lesson_notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;
