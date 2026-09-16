-- El inicio del catálogo tardaba ~4.7 s para devolver 81 filas.
--
-- `get_catalog_home()` materializaba el CTE `visible_lessons` y luego lo
-- reescaneaba desde seis subconsultas correlacionadas, una vez por curso:
-- 6 x 81 = 486 relecturas completas. El CTE no cabe en `work_mem`, así que
-- cada relectura venía de archivos temporales en disco. Medido con
-- EXPLAIN (ANALYZE, BUFFERS): temp read=321710 bloques, ~2,5 GB.
--
-- Esta migración hace dos cosas, ninguna cambia la semántica:
--   1. Reescribe la función a una sola pasada agregada sobre las lecciones.
--   2. Envuelve las políticas RLS en `(select ...)` para que Postgres las
--      evalúe como InitPlan una vez por consulta, no una vez por fila.

begin;

-- ---------------------------------------------------------------------------
-- 1. RLS: de evaluación por fila a InitPlan
-- ---------------------------------------------------------------------------
-- `has_module_access()` y `auth.uid()` ya son STABLE, pero invocadas
-- directamente en un predicado RLS Postgres las llama para cada fila
-- examinada. Envolverlas en un subselect escalar las convierte en un InitPlan
-- que se evalúa una sola vez. Es el patrón recomendado por Supabase.

alter policy "Course members can read library sources" on public.library_sources
  using ((select public.has_module_access('courses')));
alter policy "Course members can read drive items" on public.drive_items
  using ((select public.has_module_access('courses')));
alter policy "Course members can read categories" on public.categories
  using ((select public.has_module_access('courses')));
alter policy "Course members can read courses" on public.courses
  using ((select public.has_module_access('courses')));
alter policy "Course members can read course sections" on public.course_sections
  using ((select public.has_module_access('courses')));
alter policy "Course members can read lessons" on public.lessons
  using ((select public.has_module_access('courses')));
alter policy "Course members can read sync runs" on public.catalog_sync_runs
  using ((select public.has_module_access('courses')));
alter policy "Course members can read course resources" on public.course_resources
  using ((select public.has_module_access('courses')));

alter policy "Course members manage their own progress" on public.lesson_progress
  using (user_id = (select auth.uid()) and (select public.has_module_access('courses')))
  with check (user_id = (select auth.uid()) and (select public.has_module_access('courses')));
alter policy "Course members manage their own notes" on public.lesson_notes
  using (user_id = (select auth.uid()) and (select public.has_module_access('courses')))
  with check (user_id = (select auth.uid()) and (select public.has_module_access('courses')));

-- ---------------------------------------------------------------------------
-- 2. get_catalog_home(): una sola pasada en vez de 486 reescaneos
-- ---------------------------------------------------------------------------
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
  -- Un único agregado por curso en vez de una subconsulta correlacionada.
  section_counts as (
    select section.course_id, count(*) as section_count
    from section_tree section
    group by section.course_id
  ),
  visible_lessons as (
    select lesson.id, lesson.course_id,
      coalesce(section.outline_path || '/', '') || lpad(lesson.position::text, 10, '0') || ':' || lesson.id::text as outline_path
    from public.lessons lesson
    left join section_tree section on section.id = lesson.section_id
    where lesson.is_visible and (lesson.section_id is null or section.id is not null)
  ),
  -- El progreso se une UNA vez para todas las lecciones visibles. Antes esta
  -- unión se repetía dentro de tres subconsultas, por cada curso.
  lesson_state as (
    select
      lesson.course_id,
      lesson.id,
      lesson.outline_path,
      progress.state,
      progress.updated_at
    from visible_lessons lesson
    left join public.lesson_progress progress
      on progress.lesson_id = lesson.id
      and progress.user_id = (select auth.uid())
  ),
  -- Los cuatro punteros de navegación salen de un solo GROUP BY. `array_agg`
  -- con ORDER BY interno reproduce el `order by ... limit 1` que hacía cada
  -- subconsulta, y `filter` reproduce su WHERE.
  course_rollup as (
    select
      lesson.course_id,
      count(*) as lesson_count,
      count(*) filter (where lesson.state = 'completed') as completed_lesson_count,
      (array_agg(lesson.id order by lesson.updated_at desc, lesson.outline_path)
        filter (where lesson.state = 'in_progress'))[1] as resumable_lesson_id,
      (array_agg(lesson.updated_at order by lesson.updated_at desc, lesson.outline_path)
        filter (where lesson.state = 'in_progress'))[1] as resumable_updated_at,
      (array_agg(lesson.id order by lesson.outline_path)
        filter (where lesson.state is distinct from 'completed'))[1] as first_pending_lesson_id,
      (array_agg(lesson.id order by lesson.outline_path))[1] as first_lesson_id
    from lesson_state lesson
    group by lesson.course_id
  )
  select
    category.id, category.detected_title, category.custom_title, category.position,
    course.id, course.detected_title, course.custom_title, course.author, course.platform,
    course.description, course.cover_url, course.position,
    coalesce(sections.section_count, 0),
    coalesce(rollup.lesson_count, 0),
    coalesce(rollup.completed_lesson_count, 0),
    rollup.resumable_lesson_id,
    rollup.resumable_updated_at,
    rollup.first_pending_lesson_id,
    rollup.first_lesson_id
  from public.courses course
  left join public.categories category on category.id = course.category_id and category.is_visible
  left join section_counts sections on sections.course_id = course.id
  left join course_rollup rollup on rollup.course_id = course.id
  where course.is_visible and course.is_detected_course
  order by category.position nulls last, category.id, course.position, course.id;
$$;

revoke all on function public.get_catalog_home() from public;
grant execute on function public.get_catalog_home() to authenticated;

notify pgrst, 'reload schema';

commit;
