begin;

alter table public.series_episodes
  drop constraint if exists series_episodes_episode_number_check;

alter table public.series_episodes
  add constraint series_episodes_episode_number_check
  check (episode_number > 0 and episode_number <= 999);

create or replace function public.validate_series_episode_internal_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_series_code text;
  v_season_number integer;
  v_two_digit_code text;
  v_three_digit_code text;
begin
  select series.internal_code, season.season_number
  into v_series_code, v_season_number
  from public.series_seasons season
  join public.series series on series.id = season.series_id
  where season.id = new.season_id;

  v_two_digit_code := v_series_code
    || '-S' || lpad(v_season_number::text, 2, '0')
    || '-E' || lpad(
      new.episode_number::text,
      greatest(char_length(new.episode_number::text), 2),
      '0'
    );

  v_three_digit_code := v_series_code
    || '-S' || lpad(v_season_number::text, 2, '0')
    || '-E' || lpad(new.episode_number::text, 3, '0');

  if new.internal_code <> v_two_digit_code
     and new.internal_code <> v_three_digit_code then
    raise exception
      'Episode internal_code must be % or %',
      v_two_digit_code,
      v_three_digit_code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

commit;