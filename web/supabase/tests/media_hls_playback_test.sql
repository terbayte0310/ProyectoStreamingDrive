-- Run in the Supabase SQL Editor after the HLS playback migration.
-- The transaction rolls back all fixtures and access grants.

begin;

do $$
declare
  v_user_id uuid;
  v_movie_id uuid;
  v_episode_id uuid;
  v_series_id uuid;
  v_season_id uuid;
  v_source_id uuid;
  v_movie_package_id uuid;
  v_episode_package_id uuid;
  v_asset_id uuid;
begin
  select id into v_user_id from public.profiles where is_authorized order by created_at limit 1;
  if v_user_id is null then raise exception 'An authorised profile is required for this test'; end if;

  insert into public.movies (internal_code, admin_code, admin_title, status)
  values ('MOV-91001', 'HLSM-91001', 'HLS published movie', 'published') returning id into v_movie_id;
  insert into public.series (internal_code, admin_code, admin_title, status)
  values ('SER-91001', 'HLSS-91001', 'HLS published series', 'published') returning id into v_series_id;
  insert into public.series_seasons (series_id, internal_code, admin_code, admin_title, season_number, status)
  values (v_series_id, 'SER-91001-S01', 'HLSS1-91001', 'HLS season', 1, 'published') returning id into v_season_id;
  insert into public.series_episodes (season_id, internal_code, admin_code, admin_title, episode_number, status)
  values (v_season_id, 'SER-91001-S01-E01', 'HLSE-91001', 'HLS episode', 1, 'published') returning id into v_episode_id;
  insert into public.media_drive_sources (name, drive_root_folder_id)
  values ('HLS test source', 'hls-test-source') returning id into v_source_id;
  insert into public.media_hls_packages (source_id, movie_id, drive_root_folder_id, status)
  values (v_source_id, v_movie_id, 'movie-package', 'ready') returning id into v_movie_package_id;
  insert into public.media_hls_assets (package_id, drive_file_id, relative_path, asset_kind, playlist_body)
  values (v_movie_package_id, 'master-file', 'master.m3u8', 'master_playlist', '#EXTM3U') returning id into v_asset_id;
  update public.media_hls_packages set manifest_asset_id = v_asset_id where id = v_movie_package_id;
  insert into public.media_hls_packages (source_id, episode_id, drive_root_folder_id, status)
  values (v_source_id, v_episode_id, 'episode-package', 'review') returning id into v_episode_package_id;

  delete from public.user_module_access where user_id = v_user_id and module in ('movies', 'series');
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  set local role authenticated;
  if exists (select 1 from public.media_hls_packages where id = v_movie_package_id)
     or exists (select 1 from public.media_hls_assets where id = v_asset_id) then
    raise exception 'A user without a module can read HLS playback data';
  end if;

  reset role;
  insert into public.user_module_access (user_id, module) values (v_user_id, 'movies'), (v_user_id, 'series');
  set local role authenticated;
  if not exists (select 1 from public.media_hls_packages where id = v_movie_package_id)
     or not exists (select 1 from public.media_hls_assets where id = v_asset_id)
     or exists (select 1 from public.media_hls_packages where id = v_episode_package_id) then
    raise exception 'Ready/review playback visibility is incorrect';
  end if;
end;
$$;

rollback;
