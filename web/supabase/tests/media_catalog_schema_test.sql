-- Run in the Supabase SQL Editor after the media catalog migration. Everything
-- is rolled back, including temporary content and module-access changes.

begin;

do $$
declare
  v_user_id uuid;
  v_movie_published_id uuid;
  v_movie_draft_id uuid;
  v_series_published_id uuid;
  v_series_draft_id uuid;
  v_season_published_id uuid;
  v_season_draft_id uuid;
  v_episode_published_id uuid;
  v_episode_hidden_id uuid;
begin
  select id into v_user_id
  from public.profiles
  where is_authorized
  order by created_at
  limit 1;

  if v_user_id is null then
    raise exception 'An authorised profile is required for this test';
  end if;

  insert into public.movies (internal_code, admin_code, admin_title, status)
  values ('MOV-90001', 'TESTM-90001', 'Published test movie', 'published')
  returning id into v_movie_published_id;
  insert into public.movies (internal_code, admin_code, admin_title, status)
  values ('MOV-90002', 'TESTM-90002', 'Draft test movie', 'draft')
  returning id into v_movie_draft_id;

  insert into public.series (internal_code, admin_code, admin_title, status)
  values ('SER-90001', 'TESTS-90001', 'Published test series', 'published')
  returning id into v_series_published_id;
  insert into public.series (internal_code, admin_code, admin_title, status)
  values ('SER-90002', 'TESTS-90002', 'Draft test series', 'draft')
  returning id into v_series_draft_id;

  insert into public.series_seasons (series_id, internal_code, admin_code, admin_title, season_number, status)
  values (v_series_published_id, 'SER-90001-S01', 'TESTS01-90001', 'Published season', 1, 'published')
  returning id into v_season_published_id;
  insert into public.series_seasons (series_id, internal_code, admin_code, admin_title, season_number, status)
  values (v_series_published_id, 'SER-90001-S02', 'TESTS02-90001', 'Draft season', 2, 'draft')
  returning id into v_season_draft_id;
  insert into public.series_seasons (series_id, internal_code, admin_code, admin_title, season_number, status)
  values (v_series_draft_id, 'SER-90002-S01', 'TESTSD-90001', 'Season under draft series', 1, 'published');

  insert into public.series_episodes (season_id, internal_code, admin_code, admin_title, episode_number, status)
  values (v_season_published_id, 'SER-90001-S01-E01', 'TESTE-90001', 'Published episode', 1, 'published')
  returning id into v_episode_published_id;
  insert into public.series_episodes (season_id, internal_code, admin_code, admin_title, episode_number, status)
  values (v_season_draft_id, 'SER-90001-S02-E01', 'TESTE-90002', 'Episode under draft season', 1, 'published')
  returning id into v_episode_hidden_id;

  begin
    insert into public.series_seasons (series_id, internal_code, admin_title, season_number)
    values (v_series_published_id, 'SER-90001-S01', 'Duplicate season number', 1);
    raise exception 'Duplicate season number was accepted';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.series_episodes (season_id, internal_code, admin_title, episode_number)
    values (v_season_published_id, 'SER-90001-S01-E99', 'Incorrect episode code', 2);
    raise exception 'Incorrect episode code was accepted';
  exception when check_violation then
    null;
  end;

  delete from public.user_module_access
  where user_id = v_user_id and module in ('movies', 'series');

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  set local role authenticated;

  if exists (select 1 from public.movies where id in (v_movie_published_id, v_movie_draft_id))
    or exists (select 1 from public.series where id in (v_series_published_id, v_series_draft_id))
    or exists (select 1 from public.series_seasons where id in (v_season_published_id, v_season_draft_id))
    or exists (select 1 from public.series_episodes where id in (v_episode_published_id, v_episode_hidden_id)) then
    raise exception 'A user without a media module can read media records';
  end if;

  reset role;
  insert into public.user_module_access (user_id, module)
  values (v_user_id, 'movies'), (v_user_id, 'series');

  set local role authenticated;

  if not exists (select 1 from public.movies where id = v_movie_published_id)
    or exists (select 1 from public.movies where id = v_movie_draft_id) then
    raise exception 'Movie publication visibility is incorrect';
  end if;

  if not exists (select 1 from public.series where id = v_series_published_id)
    or exists (select 1 from public.series where id = v_series_draft_id)
    or not exists (select 1 from public.series_seasons where id = v_season_published_id)
    or exists (select 1 from public.series_seasons where id = v_season_draft_id)
    or not exists (select 1 from public.series_episodes where id = v_episode_published_id)
    or exists (select 1 from public.series_episodes where id = v_episode_hidden_id) then
    raise exception 'Series publication-chain visibility is incorrect';
  end if;
end;
$$;

rollback;
