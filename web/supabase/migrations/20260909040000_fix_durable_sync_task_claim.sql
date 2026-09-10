-- The return column named id shadowed an unqualified jobs.id reference.

begin;

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

notify pgrst, 'reload schema';

commit;
