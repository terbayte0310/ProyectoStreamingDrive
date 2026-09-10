-- Present known non-video course files as explicit downloadable resources.

begin;

create type public.course_resource_kind as enum ('archive', 'document', 'project', 'subtitle', 'other');

create table public.course_resources (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.library_sources(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  drive_item_id uuid not null unique references public.drive_items(id) on delete cascade,
  detected_title text not null,
  custom_title text,
  resource_kind public.course_resource_kind not null,
  group_name text not null,
  is_available boolean not null default true,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index course_resources_course_group_idx on public.course_resources(course_id, group_name, detected_title) where is_available and is_visible;
create trigger course_resources_set_updated_at before update on public.course_resources for each row execute function public.set_updated_at();
alter table public.course_resources enable row level security;
create policy "Authorized users can read course resources" on public.course_resources for select to authenticated using (public.is_authorized_user());
create policy "Admins manage course resources" on public.course_resources for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.sync_course_resources_from_drive_sync_job(p_job_id uuid, p_source_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  update public.course_resources resource
  set is_available = false
  where resource.source_id = p_source_id;

  with candidates as (
    select
      item.detected_name,
      item.drive_file_id,
      item.course_drive_file_id,
      lower(regexp_replace(item.detected_name, '^.*\\.', '')) as extension
    from public.drive_sync_job_items item
    where item.job_id = p_job_id
      and not item.is_folder
      and item.course_drive_file_id is not null
      and item.kind in ('unsupported', 'ignored')
  ), recognized as (
    select *
    from candidates
    where extension in ('srt', 'vtt', 'pdf', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'psd', 'ai', 'aep', 'prproj', 'blend', 'fig')
  )
  insert into public.course_resources (
    source_id, course_id, lesson_id, drive_item_id, detected_title, resource_kind, group_name, is_available
  )
  select
    p_source_id,
    course.id,
    lesson.id,
    drive_item.id,
    resource.detected_name,
    case
      when resource.extension in ('srt', 'vtt') then 'subtitle'::public.course_resource_kind
      when resource.extension in ('zip', 'rar', '7z') then 'archive'::public.course_resource_kind
      when resource.extension in ('pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md') then 'document'::public.course_resource_kind
      when resource.extension in ('psd', 'ai', 'aep', 'prproj', 'blend', 'fig') then 'project'::public.course_resource_kind
      else 'other'::public.course_resource_kind
    end,
    case when resource.extension in ('srt', 'vtt') then 'Subtítulos' else 'Archivos del curso' end,
    true
  from recognized resource
  join public.drive_items course_item on course_item.source_id = p_source_id and course_item.drive_file_id = resource.course_drive_file_id
  join public.courses course on course.drive_item_id = course_item.id
  join public.drive_items drive_item on drive_item.source_id = p_source_id and drive_item.drive_file_id = resource.drive_file_id
  left join lateral (
    select lesson.id
    from public.lessons lesson
    where lesson.course_id = course.id
      and lower(regexp_replace(lesson.detected_title, '[^a-z0-9]+', '', 'g')) = lower(regexp_replace(regexp_replace(resource.detected_name, '\\.(srt|vtt)$', '', 'i'), '[^a-z0-9]+', '', 'g'))
    limit 1
  ) lesson on true
  on conflict (drive_item_id) do update set
    course_id = excluded.course_id,
    detected_title = excluded.detected_title,
    group_name = excluded.group_name,
    is_available = true,
    lesson_id = excluded.lesson_id,
    resource_kind = excluded.resource_kind,
    source_id = excluded.source_id;
end;
$$;

revoke all on function public.sync_course_resources_from_drive_sync_job(uuid, uuid) from public;
grant execute on function public.sync_course_resources_from_drive_sync_job(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
