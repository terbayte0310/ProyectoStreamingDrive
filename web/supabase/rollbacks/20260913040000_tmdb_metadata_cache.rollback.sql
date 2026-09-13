-- Reverses 20260913040000_tmdb_metadata_cache.sql only. This removes cached
-- TMDB data, then restores the unused structural placeholders from issue #8.

begin;

drop table if exists public.media_tmdb_metadata;
drop type if exists public.tmdb_media_kind;

alter table public.movies add column tmdb_id bigint unique;
alter table public.series add column tmdb_id bigint unique;
alter table public.series_seasons add column tmdb_id bigint unique;
alter table public.series_episodes add column tmdb_id bigint unique;

notify pgrst, 'reload schema';

commit;
