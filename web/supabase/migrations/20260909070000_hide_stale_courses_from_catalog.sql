-- Keep historical courses recoverable without presenting them as part of the
-- active Drive snapshot.

begin;

alter table public.courses
  add column if not exists is_detected_course boolean not null default true;

create index if not exists courses_detected_catalog_idx
  on public.courses(category_id, detected_position)
  where is_detected_course and is_visible;

-- Apply the current source of truth immediately, including records left by
-- an older root/snapshot before this flag existed.
update public.courses course
set is_detected_course = false
from public.drive_items item
where course.drive_item_id = item.id
  and item.status = 'missing'
  and course.is_detected_course is distinct from false;

create or replace function public.reconcile_library_snapshot(
  p_source_id uuid,
  p_run_id uuid,
  p_root_folder_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_summary jsonb;
begin
  v_summary := public.reconcile_library_snapshot(p_source_id, p_run_id, p_items);

  update public.course_sections section
  set is_detected_section = false
  from public.drive_items item
  where section.drive_item_id = item.id
    and item.source_id = p_source_id
    and section.is_detected_section is distinct from false
    and not exists (
      select 1
      from pg_temp.sync_snapshot snapshot
      where snapshot.drive_file_id = item.drive_file_id
        and snapshot.kind = 'section'
    );

  update public.course_sections section
  set is_detected_section = true
  from public.drive_items item
  join pg_temp.sync_snapshot snapshot
    on snapshot.drive_file_id = item.drive_file_id
    and snapshot.kind = 'section'
  where section.drive_item_id = item.id
    and item.source_id = p_source_id
    and section.is_detected_section is distinct from true;

  update public.courses course
  set is_detected_course = false
  from public.drive_items item
  where course.drive_item_id = item.id
    and item.source_id = p_source_id
    and item.status = 'missing'
    and course.is_detected_course is distinct from false;

  update public.courses course
  set is_detected_course = true
  from public.drive_items item
  join pg_temp.sync_snapshot snapshot
    on snapshot.drive_file_id = item.drive_file_id
    and snapshot.kind = 'course'
  where course.drive_item_id = item.id
    and item.source_id = p_source_id
    and course.is_detected_course is distinct from true;

  update public.library_sources
  set
    drive_root_folder_id = p_root_folder_id,
    name = 'Biblioteca de cursos'
  where id = p_source_id;

  if not found then
    raise exception 'Library source does not exist' using errcode = '22023';
  end if;

  return v_summary;
end;
$$;

revoke all on function public.reconcile_library_snapshot(uuid, uuid, text, jsonb) from public;
grant execute on function public.reconcile_library_snapshot(uuid, uuid, text, jsonb) to authenticated;

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
