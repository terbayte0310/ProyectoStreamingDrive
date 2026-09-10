-- Publishing is explicitly initiated by an administrator and runs from the
-- persisted snapshot. Let this one transaction finish instead of inheriting
-- PostgREST's short statement timeout for ordinary web reads.

begin;

alter function public.publish_drive_sync_job(uuid, uuid, uuid, text)
  set statement_timeout = '0';

notify pgrst, 'reload schema';

commit;
