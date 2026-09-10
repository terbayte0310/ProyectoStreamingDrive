-- Persist Drive traversal so a local import can be resumed after a browser,
-- network, or PC interruption. Publishing remains an explicit final action.

begin;

create type public.drive_sync_job_status as enum (
  'queued', 'scanning', 'ready', 'publishing', 'completed', 'failed', 'cancelled'
);

create type public.drive_sync_task_status as enum ('queued', 'processing', 'completed', 'failed');
create type public.drive_sync_task_kind as enum ('root', 'category', 'course', 'section');

create table public.drive_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  root_folder_id text not null,
  root_name text not null,
  status public.drive_sync_job_status not null default 'queued',
  fingerprint text,
  heartbeat_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_summary text,
  counters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drive_sync_job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drive_sync_jobs(id) on delete cascade,
  folder_drive_file_id text not null,
  kind public.drive_sync_task_kind not null,
  category_drive_file_id text,
  course_drive_file_id text,
  parent_section_drive_file_id text,
  status public.drive_sync_task_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, folder_drive_file_id)
);

create table public.drive_sync_job_items (
  job_id uuid not null references public.drive_sync_jobs(id) on delete cascade,
  drive_file_id text not null,
  parent_drive_file_id text,
  kind text not null check (kind in ('root', 'category', 'course', 'section', 'lesson', 'ignored', 'unsupported', 'conflict')),
  detected_name text not null,
  detected_title text not null,
  mime_type text not null,
  byte_size bigint,
  modified_at_drive timestamptz,
  detected_position integer not null check (detected_position >= 0),
  is_folder boolean not null,
  item_status public.drive_item_status not null,
  category_drive_file_id text,
  course_drive_file_id text,
  parent_section_drive_file_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(job_id, drive_file_id)
);

create index drive_sync_job_tasks_next_idx
  on public.drive_sync_job_tasks(job_id, status, available_at, created_at);
create index drive_sync_job_items_kind_idx
  on public.drive_sync_job_items(job_id, kind);

create trigger drive_sync_jobs_set_updated_at before update on public.drive_sync_jobs for each row execute function public.set_updated_at();
create trigger drive_sync_job_tasks_set_updated_at before update on public.drive_sync_job_tasks for each row execute function public.set_updated_at();
create trigger drive_sync_job_items_set_updated_at before update on public.drive_sync_job_items for each row execute function public.set_updated_at();

alter table public.drive_sync_jobs enable row level security;
alter table public.drive_sync_job_tasks enable row level security;
alter table public.drive_sync_job_items enable row level security;

create policy "Admins manage Drive sync jobs" on public.drive_sync_jobs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage Drive sync tasks" on public.drive_sync_job_tasks for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage Drive sync items" on public.drive_sync_job_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.claim_drive_sync_tasks(p_job_id uuid, p_limit integer default 4)
returns table (
  id uuid,
  folder_drive_file_id text,
  kind public.drive_sync_task_kind,
  category_drive_file_id text,
  course_drive_file_id text,
  parent_section_drive_file_id text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 12 then
    raise exception 'Task limit must be between 1 and 12' using errcode = '22023';
  end if;

  update public.drive_sync_jobs as job
  set status = 'scanning', heartbeat_at = now(), error_summary = null
  where job.id = p_job_id and job.status in ('queued', 'scanning');
  if not found then
    raise exception 'Synchronization job is not available to run' using errcode = '22023';
  end if;

  return query
  with next_tasks as (
    select task.id
    from public.drive_sync_job_tasks task
    where task.job_id = p_job_id and task.status = 'queued' and task.available_at <= now()
    order by task.created_at, task.id
    limit p_limit
    for update skip locked
  )
  update public.drive_sync_job_tasks task
  set status = 'processing', claimed_at = now(), attempt_count = task.attempt_count + 1, last_error = null
  from next_tasks
  where task.id = next_tasks.id
  returning task.id, task.folder_drive_file_id, task.kind, task.category_drive_file_id, task.course_drive_file_id, task.parent_section_drive_file_id;
end;
$$;

create or replace function public.complete_drive_sync_task(
  p_task_id uuid,
  p_items jsonb,
  p_child_tasks jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_typeof(p_child_tasks) is distinct from 'array' then
    raise exception 'Task payloads must be arrays' using errcode = '22023';
  end if;

  select job_id into v_job_id
  from public.drive_sync_job_tasks
  where id = p_task_id and status = 'processing'
  for update;
  if not found then
    raise exception 'Synchronization task is not being processed' using errcode = '22023';
  end if;

  insert into public.drive_sync_job_items (
    job_id, drive_file_id, parent_drive_file_id, kind, detected_name, detected_title,
    mime_type, byte_size, modified_at_drive, detected_position, is_folder, item_status,
    category_drive_file_id, course_drive_file_id, parent_section_drive_file_id
  )
  select
    v_job_id,
    item->>'driveFileId',
    nullif(item->>'parentDriveFileId', ''),
    item->>'kind',
    item->>'name',
    item->>'detectedTitle',
    item->>'mimeType',
    nullif(item->>'byteSize', '')::bigint,
    nullif(item->>'modifiedAt', '')::timestamptz,
    (item->>'detectedPosition')::integer,
    (item->>'isFolder')::boolean,
    (item->>'status')::public.drive_item_status,
    nullif(item->>'categoryDriveFileId', ''),
    nullif(item->>'courseDriveFileId', ''),
    nullif(item->>'parentSectionDriveFileId', '')
  from jsonb_array_elements(p_items) as entry(item)
  on conflict (job_id, drive_file_id) do update set
    parent_drive_file_id = excluded.parent_drive_file_id,
    kind = excluded.kind,
    detected_name = excluded.detected_name,
    detected_title = excluded.detected_title,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    modified_at_drive = excluded.modified_at_drive,
    detected_position = excluded.detected_position,
    is_folder = excluded.is_folder,
    item_status = excluded.item_status,
    category_drive_file_id = excluded.category_drive_file_id,
    course_drive_file_id = excluded.course_drive_file_id,
    parent_section_drive_file_id = excluded.parent_section_drive_file_id;

  insert into public.drive_sync_job_tasks (
    job_id, folder_drive_file_id, kind, category_drive_file_id, course_drive_file_id, parent_section_drive_file_id
  )
  select
    v_job_id,
    task->>'folderDriveFileId',
    (task->>'kind')::public.drive_sync_task_kind,
    nullif(task->>'categoryDriveFileId', ''),
    nullif(task->>'courseDriveFileId', ''),
    nullif(task->>'parentSectionDriveFileId', '')
  from jsonb_array_elements(p_child_tasks) as entry(task)
  on conflict (job_id, folder_drive_file_id) do nothing;

  update public.drive_sync_job_tasks
  set status = 'completed', completed_at = now()
  where id = p_task_id;
  update public.drive_sync_jobs set heartbeat_at = now() where id = v_job_id;
end;
$$;

create or replace function public.fail_drive_sync_task(p_task_id uuid, p_error text, p_retryable boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.drive_sync_job_tasks
  set
    status = case when p_retryable and attempt_count < 4 then 'queued'::public.drive_sync_task_status else 'failed'::public.drive_sync_task_status end,
    available_at = case when p_retryable and attempt_count < 4 then now() + make_interval(secs => least(60, power(2, attempt_count)::integer) + floor(random() * 3)::integer) else now() end,
    last_error = left(coalesce(p_error, 'Drive rejected the folder request.'), 500)
  where id = p_task_id and status = 'processing'
  returning job_id into v_job_id;
  if not found then
    raise exception 'Synchronization task is not being processed' using errcode = '22023';
  end if;
  update public.drive_sync_jobs set heartbeat_at = now() where id = v_job_id;
end;
$$;

create or replace function public.refresh_drive_sync_job(p_job_id uuid)
returns public.drive_sync_job_status
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.drive_sync_job_status;
  v_counters jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'categories', count(*) filter (where kind = 'category'),
    'conflicts', count(*) filter (where kind = 'conflict'),
    'courses', count(*) filter (where kind = 'course'),
    'files', count(*) filter (where not is_folder),
    'folders', count(*) filter (where is_folder),
    'ignored', count(*) filter (where kind = 'ignored'),
    'lessons', count(*) filter (where kind = 'lesson'),
    'sections', count(*) filter (where kind = 'section'),
    'unsupported', count(*) filter (where kind = 'unsupported')
  ) into v_counters
  from public.drive_sync_job_items where job_id = p_job_id;

  if exists (select 1 from public.drive_sync_job_tasks where job_id = p_job_id and status = 'failed') then
    v_status := 'failed';
  elsif exists (select 1 from public.drive_sync_job_tasks where job_id = p_job_id and status in ('queued', 'processing')) then
    v_status := 'scanning';
  else
    v_status := 'ready';
  end if;

  update public.drive_sync_jobs
  set counters = v_counters, status = v_status, heartbeat_at = now(), finished_at = case when v_status in ('ready', 'failed') then now() else null end
  where id = p_job_id;
  if not found then
    raise exception 'Synchronization job does not exist' using errcode = '22023';
  end if;
  return v_status;
end;
$$;

create or replace function public.publish_drive_sync_job(
  p_job_id uuid,
  p_source_id uuid,
  p_run_id uuid,
  p_root_folder_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_summary jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  update public.drive_sync_jobs
  set status = 'publishing', heartbeat_at = now(), error_summary = null
  where id = p_job_id and status = 'ready' and root_folder_id = p_root_folder_id;
  if not found then
    raise exception 'Synchronization job is not ready to publish' using errcode = '22023';
  end if;

  -- A folder only remains a visible section when it contains a lesson somewhere
  -- below it. Auxiliary folders stay inventoried but do not become course modules.
  with recursive lesson_ancestors as (
    select job_id, parent_section_drive_file_id as drive_file_id
    from public.drive_sync_job_items
    where job_id = p_job_id and kind = 'lesson' and parent_section_drive_file_id is not null
    union
    select parent.job_id, parent.parent_section_drive_file_id
    from public.drive_sync_job_items parent
    join lesson_ancestors child
      on child.job_id = parent.job_id and child.drive_file_id = parent.drive_file_id
    where parent.kind = 'section' and parent.parent_section_drive_file_id is not null
  )
  update public.drive_sync_job_items section
  set kind = 'unsupported', item_status = 'unsupported', parent_section_drive_file_id = null
  where section.job_id = p_job_id and section.kind = 'section'
    and not exists (
      select 1 from lesson_ancestors ancestor
      where ancestor.job_id = section.job_id and ancestor.drive_file_id = section.drive_file_id
    );

  update public.drive_sync_job_items child
  set parent_section_drive_file_id = null
  where child.job_id = p_job_id and child.parent_section_drive_file_id is not null
    and not exists (
      select 1 from public.drive_sync_job_items parent
      where parent.job_id = child.job_id
        and parent.drive_file_id = child.parent_section_drive_file_id
        and parent.kind = 'section'
    );

  select jsonb_agg(jsonb_build_object(
    'byteSize', byte_size,
    'categoryDriveFileId', category_drive_file_id,
    'courseDriveFileId', course_drive_file_id,
    'detectedPosition', detected_position,
    'detectedTitle', detected_title,
    'driveFileId', drive_file_id,
    'isFolder', is_folder,
    'kind', kind,
    'mimeType', mime_type,
    'modifiedAt', modified_at_drive,
    'name', detected_name,
    'parentDriveFileId', parent_drive_file_id,
    'parentSectionDriveFileId', parent_section_drive_file_id,
    'status', item_status
  ) order by drive_file_id)
  into v_items
  from public.drive_sync_job_items
  where job_id = p_job_id;
  if v_items is null then
    raise exception 'Synchronization job contains no snapshot items' using errcode = '22023';
  end if;

  v_summary := public.reconcile_library_snapshot(p_source_id, p_run_id, p_root_folder_id, v_items);
  update public.drive_sync_jobs
  set counters = v_summary, fingerprint = md5(v_items::text), status = 'completed', finished_at = now(), heartbeat_at = now()
  where id = p_job_id;
  return v_summary;
end;
$$;

revoke all on function public.claim_drive_sync_tasks(uuid, integer) from public;
revoke all on function public.complete_drive_sync_task(uuid, jsonb, jsonb) from public;
revoke all on function public.fail_drive_sync_task(uuid, text, boolean) from public;
revoke all on function public.refresh_drive_sync_job(uuid) from public;
revoke all on function public.publish_drive_sync_job(uuid, uuid, uuid, text) from public;
grant execute on function public.claim_drive_sync_tasks(uuid, integer) to authenticated;
grant execute on function public.complete_drive_sync_task(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.fail_drive_sync_task(uuid, text, boolean) to authenticated;
grant execute on function public.refresh_drive_sync_job(uuid) to authenticated;
grant execute on function public.publish_drive_sync_job(uuid, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
