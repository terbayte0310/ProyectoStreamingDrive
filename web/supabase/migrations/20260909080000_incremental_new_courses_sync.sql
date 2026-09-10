-- A fast, conservative path for adding course folders without reopening the
-- already-published course trees in Drive.

begin;

alter table public.drive_sync_jobs
  add column if not exists mode text not null default 'full'
    check (mode in ('full', 'new_courses')),
  add column if not exists baseline_job_id uuid references public.drive_sync_jobs(id) on delete restrict;

create index if not exists drive_sync_jobs_baseline_idx
  on public.drive_sync_jobs(root_folder_id, status, finished_at desc)
  where status = 'completed';

create or replace function public.create_new_courses_drive_sync_job(
  p_root_folder_id text,
  p_root_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_baseline_job_id uuid;
  v_job_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select id into v_baseline_job_id
  from public.drive_sync_jobs
  where root_folder_id = p_root_folder_id and status = 'completed'
  order by finished_at desc nulls last, created_at desc
  limit 1;
  if v_baseline_job_id is null then
    raise exception 'A completed full synchronization is required before adding only new courses' using errcode = '22023';
  end if;

  insert into public.drive_sync_jobs (
    initiated_by, root_folder_id, root_name, mode, baseline_job_id
  ) values (
    auth.uid(), p_root_folder_id, p_root_name, 'new_courses', v_baseline_job_id
  ) returning id into v_job_id;

  insert into public.drive_sync_job_items (
    job_id, drive_file_id, parent_drive_file_id, kind, detected_name, detected_title,
    mime_type, byte_size, modified_at_drive, detected_position, is_folder, item_status,
    category_drive_file_id, course_drive_file_id, parent_section_drive_file_id
  )
  select
    v_job_id, drive_file_id, parent_drive_file_id, kind, detected_name, detected_title,
    mime_type, byte_size, modified_at_drive, detected_position, is_folder, item_status,
    category_drive_file_id, course_drive_file_id, parent_section_drive_file_id
  from public.drive_sync_job_items
  where job_id = v_baseline_job_id;

  insert into public.drive_sync_job_tasks (folder_drive_file_id, job_id, kind)
  values (p_root_folder_id, v_job_id, 'root');

  return v_job_id;
end;
$$;

revoke all on function public.create_new_courses_drive_sync_job(text, text) from public;
grant execute on function public.create_new_courses_drive_sync_job(text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
