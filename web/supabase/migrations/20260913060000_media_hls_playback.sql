-- Secure Drive-backed HLS playback for Movies and Series.
-- Each package belongs to exactly one movie or episode. Assets are addressed by
-- opaque ids so playlist URLs never expose Drive file ids to the page.

begin;

create type public.media_hls_package_status as enum ('draft', 'ready', 'review', 'unavailable');
create type public.media_hls_asset_kind as enum ('master_playlist', 'media_playlist', 'segment', 'audio', 'subtitle', 'key', 'other');

create table public.media_drive_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0 and char_length(name) <= 120),
  drive_root_folder_id text not null unique check (char_length(btrim(drive_root_folder_id)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.media_hls_packages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.media_drive_sources(id),
  movie_id uuid references public.movies(id),
  episode_id uuid references public.series_episodes(id),
  drive_root_folder_id text not null check (char_length(btrim(drive_root_folder_id)) > 0),
  status public.media_hls_package_status not null default 'draft',
  manifest_asset_id uuid,
  scanned_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((movie_id is null) <> (episode_id is null))
);

create unique index media_hls_packages_movie_id_key on public.media_hls_packages(movie_id) where movie_id is not null;
create unique index media_hls_packages_episode_id_key on public.media_hls_packages(episode_id) where episode_id is not null;
create index media_hls_packages_source_status_idx on public.media_hls_packages(source_id, status);

create table public.media_hls_assets (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.media_hls_packages(id),
  drive_file_id text not null check (char_length(btrim(drive_file_id)) > 0),
  relative_path text not null check (
    char_length(btrim(relative_path)) > 0
    and relative_path !~ '(^/|(^|/)\\.\\.(/|$))'
  ),
  asset_kind public.media_hls_asset_kind not null,
  content_type text check (content_type is null or char_length(content_type) <= 160),
  language_code text check (language_code is null or language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  playlist_body text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, relative_path)
);

alter table public.media_hls_packages
  add constraint media_hls_packages_manifest_asset_id_fkey
  foreign key (manifest_asset_id) references public.media_hls_assets(id) deferrable initially deferred;

create unique index media_hls_assets_one_master_per_package
  on public.media_hls_assets(package_id)
  where asset_kind = 'master_playlist';
create index media_hls_assets_package_idx on public.media_hls_assets(package_id);

create or replace function public.validate_media_hls_manifest_asset()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_package_id uuid;
begin
  if new.manifest_asset_id is null then return new; end if;
  select package_id into v_package_id from public.media_hls_assets where id = new.manifest_asset_id;
  if v_package_id is null or v_package_id <> new.id then
    raise exception 'The manifest asset must belong to its HLS package' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger media_hls_packages_validate_manifest_asset
before insert or update of manifest_asset_id on public.media_hls_packages
for each row execute function public.validate_media_hls_manifest_asset();

create trigger media_drive_sources_set_updated_at before update on public.media_drive_sources
for each row execute function public.set_updated_at();
create trigger media_hls_packages_set_updated_at before update on public.media_hls_packages
for each row execute function public.set_updated_at();
create trigger media_hls_assets_set_updated_at before update on public.media_hls_assets
for each row execute function public.set_updated_at();

create or replace function public.media_hls_package_is_playable(p_package_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.media_hls_packages package
    left join public.movies movie on movie.id = package.movie_id
    left join public.series_episodes episode on episode.id = package.episode_id
    left join public.series_seasons season on season.id = episode.season_id
    left join public.series series on series.id = season.series_id
    where package.id = p_package_id
      and package.status = 'ready'
      and package.manifest_asset_id is not null
      and (
        (package.movie_id is not null and movie.status = 'published')
        or (
          package.episode_id is not null
          and episode.status = 'published'
          and season.status = 'published'
          and series.status = 'published'
        )
      )
  );
$$;

revoke all on function public.media_hls_package_is_playable(uuid) from public;
grant execute on function public.media_hls_package_is_playable(uuid) to authenticated;

alter table public.media_drive_sources enable row level security;
alter table public.media_hls_packages enable row level security;
alter table public.media_hls_assets enable row level security;

create policy "Media administrators manage Drive sources"
on public.media_drive_sources for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "Movie members read ready playback packages"
on public.media_hls_packages for select to authenticated
using (
  status = 'ready'
  and movie_id is not null
  and public.has_module_access('movies')
  and exists (select 1 from public.movies where id = movie_id and status = 'published')
);
create policy "Series members read ready playback packages"
on public.media_hls_packages for select to authenticated
using (
  status = 'ready'
  and episode_id is not null
  and public.has_module_access('series')
  and exists (
    select 1
    from public.series_episodes episode
    join public.series_seasons season on season.id = episode.season_id
    join public.series series on series.id = season.series_id
    where episode.id = episode_id
      and episode.status = 'published'
      and season.status = 'published'
      and series.status = 'published'
  )
);
create policy "Media administrators manage playback packages"
on public.media_hls_packages for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "Movie members read ready playback assets"
on public.media_hls_assets for select to authenticated
using (
  is_active
  and
  public.has_module_access('movies')
  and exists (
    select 1 from public.media_hls_packages package
    join public.movies movie on movie.id = package.movie_id
    where package.id = package_id
      and package.status = 'ready'
      and movie.status = 'published'
  )
);
create policy "Series members read ready playback assets"
on public.media_hls_assets for select to authenticated
using (
  is_active
  and
  public.has_module_access('series')
  and exists (
    select 1
    from public.media_hls_packages package
    join public.series_episodes episode on episode.id = package.episode_id
    join public.series_seasons season on season.id = episode.season_id
    join public.series series on series.id = season.series_id
    where package.id = package_id
      and package.status = 'ready'
      and episode.status = 'published'
      and season.status = 'published'
      and series.status = 'published'
  )
);
create policy "Media administrators manage playback assets"
on public.media_hls_assets for all to authenticated
using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

commit;
