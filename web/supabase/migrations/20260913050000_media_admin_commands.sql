-- Atomic internal-code allocation for the administrator media panel.

begin;

create sequence public.movie_internal_code_sequence as bigint minvalue 1 start with 1;
create sequence public.series_internal_code_sequence as bigint minvalue 1 start with 1;

select setval(
  'public.movie_internal_code_sequence',
  coalesce((select max((substring(internal_code from '^MOV-([0-9]+)$'))::bigint) from public.movies), 0) + 1,
  false
);
select setval(
  'public.series_internal_code_sequence',
  coalesce((select max((substring(internal_code from '^SER-([0-9]+)$'))::bigint) from public.series), 0) + 1,
  false
);

revoke all on sequence public.movie_internal_code_sequence from public;
revoke all on sequence public.series_internal_code_sequence from public;

create or replace function public.next_movie_internal_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = 'insufficient_privilege';
  end if;
  return 'MOV-' || lpad(nextval('public.movie_internal_code_sequence')::text, 5, '0');
end;
$$;

create or replace function public.next_series_internal_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = 'insufficient_privilege';
  end if;
  return 'SER-' || lpad(nextval('public.series_internal_code_sequence')::text, 5, '0');
end;
$$;

revoke all on function public.next_movie_internal_code() from public;
revoke all on function public.next_series_internal_code() from public;
grant execute on function public.next_movie_internal_code() to authenticated;
grant execute on function public.next_series_internal_code() to authenticated;

notify pgrst, 'reload schema';

commit;
