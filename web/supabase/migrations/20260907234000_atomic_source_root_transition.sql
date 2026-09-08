-- Keep the pilot source identity while atomically promoting it to the full library root.

begin;

create or replace function public.reconcile_library_snapshot(
  p_source_id uuid,
  p_run_id uuid,
  p_root_folder_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_summary jsonb;
begin
  v_summary := public.reconcile_library_snapshot(p_source_id, p_run_id, p_items);

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

commit;
