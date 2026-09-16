begin;

alter table public.series_episodes
  drop constraint if exists series_episodes_episode_number_check;

alter table public.series_episodes
  add constraint series_episodes_episode_number_check
  check (episode_number > 0 and episode_number <= 999);

commit;
