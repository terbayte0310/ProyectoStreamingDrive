-- Count task progress in PostgreSQL so the UI never truncates at PostgREST's row limit.

begin;

create or replace function public.get_drive_sync_job_progress(p_job_ids uuid[])
returns table (job_id uuid, queued bigint, processing bigint, completed bigint, failed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    task.job_id,
    count(*) filter (where task.status = 'queued'),
    count(*) filter (where task.status = 'processing'),
    count(*) filter (where task.status = 'completed'),
    count(*) filter (where task.status = 'failed')
  from public.drive_sync_job_tasks task
  where task.job_id = any(p_job_ids)
  group by task.job_id;
$$;

revoke all on function public.get_drive_sync_job_progress(uuid[]) from public;
grant execute on function public.get_drive_sync_job_progress(uuid[]) to authenticated;
notify pgrst, 'reload schema';

commit;
