-- TMDB metadata is cached separately from the internal media catalogue. The
-- cache has no Drive or playback data and is never a source of access rights.

begin;

create type public.tmdb_media_kind as enum ('movie', 'series', 'season', 'episode');

-- The tmdb_id placeholders from the structural migration are replaced by this
-- one-to-one cache. Keeping the association and cached data together prevents
-- partial links and makes unlinking an ordinary update rather than a delete.
alter table public.movies drop column tmdb_id;
alter table public.series drop column tmdb_id;
alter table public.series_seasons drop column tmdb_id;
alter table public.series_episodes drop column tmdb_id;

create table public.media_tmdb_metadata (
  id uuid primary key default gen_random_uuid(),
  media_kind public.tmdb_media_kind not null,
  movie_id uuid unique references public.movies(id) on delete cascade,
  series_id uuid unique references public.series(id) on delete cascade,
  season_id uuid unique references public.series_seasons(id) on delete cascade,
  episode_id uuid unique references public.series_episodes(id) on delete cascade,
  tmdb_id bigint check (tmdb_id is null or tmdb_id > 0),
  tmdb_parent_id bigint check (tmdb_parent_id is null or tmdb_parent_id > 0),
  tmdb_url text,
  localized_title text,
  original_title text,
  overview text,
  tagline text,
  poster_path text,
  backdrop_path text,
  release_date date,
  runtime_minutes integer check (runtime_minutes is null or runtime_minutes >= 0),
  genres jsonb not null default '[]'::jsonb check (jsonb_typeof(genres) = 'array'),
  vote_average numeric(4, 1) check (vote_average is null or (vote_average >= 0 and vote_average <= 10)),
  vote_count integer check (vote_count is null or vote_count >= 0),
  raw_payload jsonb check (raw_payload is null or jsonb_typeof(raw_payload) = 'object'),
  tmdb_locale text,
  tmdb_fallback_locale text,
  linked_at timestamptz,
  synced_at timestamptz,
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (media_kind = 'movie' and movie_id is not null and series_id is null and season_id is null and episode_id is null)
    or (media_kind = 'series' and movie_id is null and series_id is not null and season_id is null and episode_id is null)
    or (media_kind = 'season' and movie_id is null and series_id is null and season_id is not null and episode_id is null)
    or (media_kind = 'episode' and movie_id is null and series_id is null and season_id is null and episode_id is not null)
  ),
  check (
    (media_kind in ('movie', 'series') and tmdb_parent_id is null)
    or (media_kind in ('season', 'episode') and (tmdb_id is null or tmdb_parent_id is not null))
  ),
  unique (media_kind, tmdb_id)
);

create index media_tmdb_metadata_tmdb_id_idx
  on public.media_tmdb_metadata(tmdb_id)
  where tmdb_id is not null;

create trigger media_tmdb_metadata_set_updated_at
before update on public.media_tmdb_metadata
for each row execute function public.set_updated_at();

alter table public.media_tmdb_metadata enable row level security;

-- Consumers can see cache data only when the related content is already
-- readable through the Movie/Series publication and module policies.
create policy "Members read available TMDB metadata"
on public.media_tmdb_metadata for select to authenticated
using (
  (movie_id is not null and exists (select 1 from public.movies where movies.id = movie_id))
  or (series_id is not null and exists (select 1 from public.series where series.id = series_id))
  or (season_id is not null and exists (select 1 from public.series_seasons where series_seasons.id = season_id))
  or (episode_id is not null and exists (select 1 from public.series_episodes where series_episodes.id = episode_id))
);

create policy "Admins insert TMDB metadata"
on public.media_tmdb_metadata for insert to authenticated
with check (public.is_admin());

create policy "Admins update TMDB metadata"
on public.media_tmdb_metadata for update to authenticated
using (public.is_admin())
with check (public.is_admin());

notify pgrst, 'reload schema';

commit;
