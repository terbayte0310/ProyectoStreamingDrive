-- Reverses 20260913030000_media_catalog_schema.sql only. Run manually in the
-- Supabase SQL Editor if the media catalog schema must be undone.

begin;

drop table if exists public.series_episodes;
drop table if exists public.series_seasons;
drop table if exists public.series;
drop table if exists public.movies;

drop function if exists public.is_published_series_season(uuid);
drop function if exists public.is_published_series(uuid);
drop function if exists public.prevent_media_internal_code_change();
drop function if exists public.validate_series_episode_internal_code();
drop function if exists public.validate_series_season_internal_code();

drop type if exists public.media_publication_status;

notify pgrst, 'reload schema';

commit;
