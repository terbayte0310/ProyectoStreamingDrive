-- Keep auxiliary Drive folders inventoried without presenting them as course modules.

begin;

alter table public.course_sections
  add column is_detected_section boolean not null default true;

create index course_sections_detected_outline_idx
  on public.course_sections(course_id, parent_section_id, position)
  where is_detected_section;

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

  -- The base reconciliation leaves historical section rows intact so manual data is
  -- never destroyed. This flag supplies the automatic, current snapshot meaning.
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
