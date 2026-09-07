-- Reorder one complete group of sibling sections and lessons atomically.
-- Positions are shared across both tables because Drive folders and files can be interleaved.

begin;

alter table public.course_sections add column detected_position integer;
alter table public.lessons add column detected_position integer;

update public.course_sections set detected_position = position;
update public.lessons set detected_position = position;

alter table public.course_sections alter column detected_position set default 0;
alter table public.course_sections alter column detected_position set not null;
alter table public.lessons alter column detected_position set default 0;
alter table public.lessons alter column detected_position set not null;

create or replace function public.set_initial_outline_position()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.position = new.detected_position;
  return new;
end;
$$;

create trigger course_sections_set_initial_position
before insert on public.course_sections
for each row execute function public.set_initial_outline_position();

create trigger lessons_set_initial_position
before insert on public.lessons
for each row execute function public.set_initial_outline_position();

create or replace function public.reorder_course_outline(
  p_course_id uuid,
  p_parent_section_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  expected_count integer;
  item_count integer;
  distinct_count integer;
  item jsonb;
  item_index bigint;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Items must be a JSON array' using errcode = '22023';
  end if;

  select
    (select count(*) from public.course_sections where course_id = p_course_id and parent_section_id is not distinct from p_parent_section_id)
    +
    (select count(*) from public.lessons where course_id = p_course_id and section_id is not distinct from p_parent_section_id)
  into expected_count;

  select count(*), count(distinct value->>'kind' || ':' || value->>'id')
  into item_count, distinct_count
  from jsonb_array_elements(p_items);

  if item_count <> expected_count or distinct_count <> item_count then
    raise exception 'The submitted outline must contain every sibling exactly once' using errcode = '22023';
  end if;

  for item, item_index in
    select value, ordinality - 1
    from jsonb_array_elements(p_items) with ordinality
  loop
    if item->>'kind' = 'section' then
      update public.course_sections
      set position = item_index
      where id = (item->>'id')::uuid
        and course_id = p_course_id
        and parent_section_id is not distinct from p_parent_section_id;
    elsif item->>'kind' = 'lesson' then
      update public.lessons
      set position = item_index
      where id = (item->>'id')::uuid
        and course_id = p_course_id
        and section_id is not distinct from p_parent_section_id;
    else
      raise exception 'Unknown outline item kind' using errcode = '22023';
    end if;

    if not found then
      raise exception 'Outline item does not belong to this sibling group' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public.reorder_course_outline(uuid, uuid, jsonb) from public;
grant execute on function public.reorder_course_outline(uuid, uuid, jsonb) to authenticated;

commit;
