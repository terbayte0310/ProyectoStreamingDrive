-- Reverses 20260916010000_optimize_catalog_home.sql only.
-- Restaura los predicados RLS sin envolver y la definición de
-- `get_catalog_home()` tal y como quedó en
-- 20260909070000_hide_stale_courses_from_catalog.sql.

begin;

alter policy "Course members can read library sources" on public.library_sources
  using (public.has_module_access('courses'));
alter policy "Course members can read drive items" on public.drive_items
  using (public.has_module_access('courses'));
alter policy "Course members can read categories" on public.categories
  using (public.has_module_access('courses'));
alter policy "Course members can read courses" on public.courses
  using (public.has_module_access('courses'));
alter policy "Course members can read course sections" on public.course_sections
  using (public.has_module_access('courses'));
alter policy "Course members can read lessons" on public.lessons
  using (public.has_module_access('courses'));
alter policy "Course members can read sync runs" on public.catalog_sync_runs
  using (public.has_module_access('courses'));
alter policy "Course members can read course resources" on public.course_resources
  using (public.has_module_access('courses'));

alter policy "Course members manage their own progress" on public.lesson_progress
  using (user_id = auth.uid() and public.has_module_access('courses'))
  with check (user_id = auth.uid() and public.has_module_access('courses'));
alter policy "Course members manage their own notes" on public.lesson_notes
  using (user_id = auth.uid() and public.has_module_access('courses'))
  with check (user_id = auth.uid() and public.has_module_access('courses'));

create or replace function public.get_catalog_home()
returns table (
  category_id uuid,
  category_detected_title text,
  category_custom_title text,
  category_position integer,
  course_id uuid,
  course_detected_title text,
  course_custom_title text,
  course_author text,
  course_platform text,
  course_description text,
  course_cover_url text,
  course_position integer,
  section_count bigint,
  lesson_count bigint,
  completed_lesson_count bigint,
  resumable_lesson_id uuid,
  resumable_updated_at timestamptz,
  first_pending_lesson_id uuid,
  first_lesson_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive section_tree as (
    select section.id, section.course_id, section.parent_section_id,
      lpad(section.position::text, 10, '0') || ':' || section.id::text as outline_path
    from public.course_sections section
    where section.parent_section_id is null and section.is_detected_section and section.is_visible
    union all
    select child.id, child.course_id, child.parent_section_id,
      parent.outline_path || '/' || lpad(child.position::text, 10, '0') || ':' || child.id::text
    from public.course_sections child
    join section_tree parent on parent.id = child.parent_section_id
    where child.is_detected_section and child.is_visible
  ),
  visible_lessons as (
    select lesson.id, lesson.course_id,
      coalesce(section.outline_path || '/', '') || lpad(lesson.position::text, 10, '0') || ':' || lesson.id::text as outline_path
    from public.lessons lesson
    left join section_tree section on section.id = lesson.section_id
    where lesson.is_visible and (lesson.section_id is null or section.id is not null)
  )
  select
    category.id, category.detected_title, category.custom_title, category.position,
    course.id, course.detected_title, course.custom_title, course.author, course.platform,
    course.description, course.cover_url, course.position,
    (select count(*) from section_tree section where section.course_id = course.id),
    (select count(*) from visible_lessons lesson where lesson.course_id = course.id),
    (
      select count(*) from visible_lessons lesson
      join public.lesson_progress progress on progress.lesson_id = lesson.id and progress.user_id = auth.uid()
      where lesson.course_id = course.id and progress.state = 'completed'
    ),
    (
      select lesson.id from visible_lessons lesson
      join public.lesson_progress progress on progress.lesson_id = lesson.id and progress.user_id = auth.uid()
      where lesson.course_id = course.id and progress.state = 'in_progress'
      order by progress.updated_at desc, lesson.outline_path limit 1
    ),
    (
      select progress.updated_at from visible_lessons lesson
      join public.lesson_progress progress on progress.lesson_id = lesson.id and progress.user_id = auth.uid()
      where lesson.course_id = course.id and progress.state = 'in_progress'
      order by progress.updated_at desc, lesson.outline_path limit 1
    ),
    (
      select lesson.id from visible_lessons lesson
      left join public.lesson_progress progress on progress.lesson_id = lesson.id and progress.user_id = auth.uid()
      where lesson.course_id = course.id and progress.state is distinct from 'completed'
      order by lesson.outline_path limit 1
    ),
    (
      select lesson.id from visible_lessons lesson
      where lesson.course_id = course.id order by lesson.outline_path limit 1
    )
  from public.courses course
  left join public.categories category on category.id = course.category_id and category.is_visible
  where course.is_visible and course.is_detected_course
  order by category.position nulls last, category.id, course.position, course.id;
$$;

revoke all on function public.get_catalog_home() from public;
grant execute on function public.get_catalog_home() to authenticated;

notify pgrst, 'reload schema';

commit;
