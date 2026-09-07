-- Reconcile one complete Drive snapshot atomically while preserving manual catalog fields.

begin;

alter table public.categories add column detected_position integer;
alter table public.courses add column detected_position integer;

update public.categories set detected_position = position;
update public.courses set detected_position = position;

alter table public.categories alter column detected_position set default 0;
alter table public.categories alter column detected_position set not null;
alter table public.courses alter column detected_position set default 0;
alter table public.courses alter column detected_position set not null;

create trigger categories_set_initial_position
before insert on public.categories
for each row execute function public.set_initial_outline_position();

create trigger courses_set_initial_position
before insert on public.courses
for each row execute function public.set_initial_outline_position();

alter table public.catalog_sync_runs
  add column categories_seen integer not null default 0,
  add column courses_seen integer not null default 0,
  add column sections_seen integer not null default 0,
  add column lessons_seen integer not null default 0,
  add column unsupported_items integer not null default 0,
  add column conflict_items integer not null default 0,
  add column missing_items integer not null default 0,
  add column restored_items integer not null default 0,
  add column new_items integer not null default 0,
  add column updated_items integer not null default 0;

-- Old interrupted pilot runs must not block the new single-run invariant.
update public.catalog_sync_runs
set
  error_summary = coalesce(error_summary, 'Ejecución cerrada al activar la sincronización atómica.'),
  finished_at = coalesce(finished_at, now()),
  status = 'failed'
where status = 'running';

create unique index catalog_sync_runs_one_running_per_source_idx
on public.catalog_sync_runs(source_id)
where status = 'running';

create or replace function public.reconcile_library_snapshot(
  p_source_id uuid,
  p_run_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_conflicts integer;
  v_new integer;
  v_restored integer;
  v_updated integer;
  v_summary jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  perform 1 from public.library_sources where id = p_source_id for update;
  if not found then
    raise exception 'Library source does not exist' using errcode = '22023';
  end if;

  perform 1
  from public.catalog_sync_runs
  where id = p_run_id and source_id = p_source_id and status = 'running';
  if not found then
    raise exception 'Synchronization run is not active for this source' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Snapshot must be a non-empty JSON array' using errcode = '22023';
  end if;

  create temporary table sync_snapshot (
    drive_file_id text primary key,
    parent_drive_file_id text,
    kind text not null,
    detected_name text not null,
    mime_type text not null,
    byte_size bigint,
    modified_at_drive timestamptz,
    detected_position integer not null,
    is_folder boolean not null,
    item_status public.drive_item_status not null,
    category_drive_file_id text,
    course_drive_file_id text,
    parent_section_drive_file_id text
  ) on commit drop;

  insert into sync_snapshot (
    drive_file_id,
    parent_drive_file_id,
    kind,
    detected_name,
    mime_type,
    byte_size,
    modified_at_drive,
    detected_position,
    is_folder,
    item_status,
    category_drive_file_id,
    course_drive_file_id,
    parent_section_drive_file_id
  )
  select
    item->>'driveFileId',
    nullif(item->>'parentDriveFileId', ''),
    item->>'kind',
    item->>'name',
    item->>'mimeType',
    nullif(item->>'byteSize', '')::bigint,
    nullif(item->>'modifiedAt', '')::timestamptz,
    (item->>'detectedPosition')::integer,
    (item->>'isFolder')::boolean,
    case item->>'status'
      when 'available' then 'available'::public.drive_item_status
      when 'ignored' then 'ignored'::public.drive_item_status
      when 'unsupported' then 'unsupported'::public.drive_item_status
      else null
    end,
    nullif(item->>'categoryDriveFileId', ''),
    nullif(item->>'courseDriveFileId', ''),
    nullif(item->>'parentSectionDriveFileId', '')
  from jsonb_array_elements(p_items) as entry(item);

  if exists (
    select 1 from sync_snapshot
    where drive_file_id is null
      or detected_name is null
      or detected_name = ''
      or mime_type is null
      or kind not in ('root', 'category', 'course', 'section', 'lesson', 'ignored', 'unsupported', 'conflict')
      or detected_position < 0
      or item_status is null
  ) then
    raise exception 'Snapshot contains an invalid item' using errcode = '22023';
  end if;

  if (select count(*) from sync_snapshot where kind = 'root') <> 1 then
    raise exception 'Snapshot must contain exactly one root' using errcode = '22023';
  end if;

  if exists (
    select 1
    from sync_snapshot child
    left join sync_snapshot parent on parent.drive_file_id = child.parent_drive_file_id
    where child.kind <> 'root' and parent.drive_file_id is null
  ) then
    raise exception 'Snapshot contains an item whose parent is absent' using errcode = '22023';
  end if;

  if exists (
    select 1
    from sync_snapshot item
    left join sync_snapshot category
      on category.drive_file_id = item.category_drive_file_id and category.kind = 'category'
    where item.kind in ('course', 'section', 'lesson') and category.drive_file_id is null
  ) or exists (
    select 1
    from sync_snapshot item
    left join sync_snapshot course
      on course.drive_file_id = item.course_drive_file_id and course.kind = 'course'
    where item.kind in ('section', 'lesson') and course.drive_file_id is null
  ) or exists (
    select 1
    from sync_snapshot item
    left join sync_snapshot section
      on section.drive_file_id = item.parent_section_drive_file_id and section.kind = 'section'
    where item.parent_section_drive_file_id is not null and section.drive_file_id is null
  ) then
    raise exception 'Snapshot contains an invalid catalog reference' using errcode = '22023';
  end if;

  select count(*) into v_new
  from sync_snapshot snapshot
  left join public.drive_items existing
    on existing.source_id = p_source_id and existing.drive_file_id = snapshot.drive_file_id
  where existing.id is null;

  select count(*) into v_restored
  from sync_snapshot snapshot
  join public.drive_items existing
    on existing.source_id = p_source_id and existing.drive_file_id = snapshot.drive_file_id
  where existing.status = 'missing' and snapshot.item_status <> 'missing';

  select count(*) into v_updated
  from sync_snapshot snapshot
  join public.drive_items existing
    on existing.source_id = p_source_id and existing.drive_file_id = snapshot.drive_file_id
  where existing.detected_name is distinct from snapshot.detected_name
    or existing.parent_drive_file_id is distinct from snapshot.parent_drive_file_id
    or existing.mime_type is distinct from snapshot.mime_type
    or existing.byte_size is distinct from snapshot.byte_size
    or existing.modified_at_drive is distinct from snapshot.modified_at_drive
    or existing.status is distinct from snapshot.item_status;

  insert into public.drive_items (
    source_id,
    drive_file_id,
    parent_drive_file_id,
    detected_name,
    mime_type,
    byte_size,
    modified_at_drive,
    is_folder,
    status,
    last_seen_at
  )
  select
    p_source_id,
    drive_file_id,
    parent_drive_file_id,
    detected_name,
    mime_type,
    byte_size,
    modified_at_drive,
    is_folder,
    item_status,
    now()
  from sync_snapshot
  on conflict (source_id, drive_file_id) do update set
    parent_drive_file_id = excluded.parent_drive_file_id,
    detected_name = excluded.detected_name,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    modified_at_drive = excluded.modified_at_drive,
    is_folder = excluded.is_folder,
    status = excluded.status,
    last_seen_at = excluded.last_seen_at;

  update public.drive_items existing
  set status = 'missing'
  where existing.source_id = p_source_id
    and not exists (
      select 1 from sync_snapshot snapshot where snapshot.drive_file_id = existing.drive_file_id
    );

  insert into public.categories (source_id, drive_item_id, detected_title, detected_position)
  select p_source_id, drive_item.id, snapshot.detected_name, snapshot.detected_position
  from sync_snapshot snapshot
  join public.drive_items drive_item
    on drive_item.source_id = p_source_id and drive_item.drive_file_id = snapshot.drive_file_id
  where snapshot.kind = 'category'
  on conflict (drive_item_id) do update set
    source_id = excluded.source_id,
    detected_title = excluded.detected_title,
    detected_position = excluded.detected_position;

  insert into public.courses (category_id, drive_item_id, detected_title, detected_position)
  select category.id, course_item.id, snapshot.detected_name, snapshot.detected_position
  from sync_snapshot snapshot
  join public.drive_items course_item
    on course_item.source_id = p_source_id and course_item.drive_file_id = snapshot.drive_file_id
  join public.drive_items category_item
    on category_item.source_id = p_source_id and category_item.drive_file_id = snapshot.category_drive_file_id
  join public.categories category on category.drive_item_id = category_item.id
  where snapshot.kind = 'course'
  on conflict (drive_item_id) do update set
    category_id = excluded.category_id,
    detected_title = excluded.detected_title,
    detected_position = excluded.detected_position;

  -- First remove old parents inside this transaction so moved/new section trees can be rebuilt safely.
  insert into public.course_sections (
    course_id,
    drive_item_id,
    parent_section_id,
    detected_title,
    detected_position
  )
  select course.id, section_item.id, null, snapshot.detected_name, snapshot.detected_position
  from sync_snapshot snapshot
  join public.drive_items section_item
    on section_item.source_id = p_source_id and section_item.drive_file_id = snapshot.drive_file_id
  join public.drive_items course_item
    on course_item.source_id = p_source_id and course_item.drive_file_id = snapshot.course_drive_file_id
  join public.courses course on course.drive_item_id = course_item.id
  where snapshot.kind = 'section'
  on conflict (drive_item_id) do update set
    course_id = excluded.course_id,
    parent_section_id = null,
    detected_title = excluded.detected_title,
    detected_position = excluded.detected_position;

  update public.course_sections section
  set parent_section_id = parent_section.id
  from sync_snapshot snapshot
  join public.drive_items section_item
    on section_item.source_id = p_source_id and section_item.drive_file_id = snapshot.drive_file_id
  join public.drive_items parent_item
    on parent_item.source_id = p_source_id and parent_item.drive_file_id = snapshot.parent_section_drive_file_id
  join public.course_sections parent_section on parent_section.drive_item_id = parent_item.id
  where snapshot.kind = 'section'
    and snapshot.parent_section_drive_file_id is not null
    and section.drive_item_id = section_item.id;

  insert into public.lessons (
    course_id,
    section_id,
    drive_item_id,
    detected_title,
    media_type,
    detected_position
  )
  select
    course.id,
    section.id,
    lesson_item.id,
    snapshot.detected_name,
    case when snapshot.mime_type like 'audio/%' then 'audio'::public.lesson_media_type else 'video'::public.lesson_media_type end,
    snapshot.detected_position
  from sync_snapshot snapshot
  join public.drive_items lesson_item
    on lesson_item.source_id = p_source_id and lesson_item.drive_file_id = snapshot.drive_file_id
  join public.drive_items course_item
    on course_item.source_id = p_source_id and course_item.drive_file_id = snapshot.course_drive_file_id
  join public.courses course on course.drive_item_id = course_item.id
  left join public.drive_items section_item
    on section_item.source_id = p_source_id and section_item.drive_file_id = snapshot.parent_section_drive_file_id
  left join public.course_sections section on section.drive_item_id = section_item.id
  where snapshot.kind = 'lesson'
  on conflict (drive_item_id) do update set
    course_id = excluded.course_id,
    section_id = excluded.section_id,
    detected_title = excluded.detected_title,
    media_type = excluded.media_type,
    detected_position = excluded.detected_position;

  select count(*) into v_conflicts from sync_snapshot where kind = 'conflict';

  v_summary = jsonb_build_object(
    'categories', (select count(*) from sync_snapshot where kind = 'category'),
    'conflicts', v_conflicts,
    'courses', (select count(*) from sync_snapshot where kind = 'course'),
    'files', (select count(*) from sync_snapshot where not is_folder),
    'folders', (select count(*) from sync_snapshot where is_folder),
    'ignored', (select count(*) from sync_snapshot where kind = 'ignored'),
    'lessons', (select count(*) from sync_snapshot where kind = 'lesson'),
    'missing', (select count(*) from public.drive_items where source_id = p_source_id and status = 'missing'),
    'new', v_new,
    'restored', v_restored,
    'sections', (select count(*) from sync_snapshot where kind = 'section'),
    'unsupported', (select count(*) from sync_snapshot where kind = 'unsupported'),
    'updated', v_updated
  );

  update public.catalog_sync_runs
  set
    categories_seen = (v_summary->>'categories')::integer,
    conflict_items = v_conflicts,
    courses_seen = (v_summary->>'courses')::integer,
    files_seen = (v_summary->>'files')::integer,
    finished_at = now(),
    folders_seen = (v_summary->>'folders')::integer,
    ignored_items = (v_summary->>'ignored')::integer,
    lessons_seen = (v_summary->>'lessons')::integer,
    missing_items = (v_summary->>'missing')::integer,
    new_items = v_new,
    restored_items = v_restored,
    sections_seen = (v_summary->>'sections')::integer,
    status = 'completed',
    unsupported_items = (v_summary->>'unsupported')::integer,
    updated_items = v_updated
  where id = p_run_id;

  update public.library_sources
  set last_scanned_at = now(), last_scan_status = 'completed'
  where id = p_source_id;

  return v_summary;
end;
$$;

revoke all on function public.reconcile_library_snapshot(uuid, uuid, jsonb) from public;
grant execute on function public.reconcile_library_snapshot(uuid, uuid, jsonb) to authenticated;

commit;
