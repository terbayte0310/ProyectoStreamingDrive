begin;

create or replace function public.validate_series_episode_internal_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_series_code text;
  v_season_number integer;
  v_expected_code text;
begin
  select series.internal_code, season.season_number
  into v_series_code, v_season_number
  from public.series_seasons season
  join public.series series on series.id = season.series_id
  where season.id = new.season_id;

  v_expected_code := v_series_code
    || '-S' || lpad(v_season_number::text, 2, '0')
    || '-E' || lpad(new.episode_number::text, greatest(char_length(new.episode_number::text), 2), '0');
  if new.internal_code <> v_expected_code then
    raise exception 'Episode internal_code must be %', v_expected_code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

commit;
