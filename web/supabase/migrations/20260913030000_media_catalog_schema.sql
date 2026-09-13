-- Structural catalog for the Movies and Series modules. Metadata enrichment,
-- Drive sources, and playback are deliberately introduced in later migrations.

begin;

create type public.media_publication_status as enum ('draft', 'published');

create table public.movies (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique check (internal_code ~ '^MOV-[0-9]{5,}$'),
  admin_code text unique check (admin_code is null or admin_code ~ '^[A-Z0-9]+-[0-9]{5,}$'),
  admin_title text not null check (char_length(btrim(admin_title)) > 0),
  status public.media_publication_status not null default 'draft',
  tmdb_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.series (
  id uuid primary key default gen_random_uuid(),
  internal_code text not null unique check (internal_code ~ '^SER-[0-9]{5,}$'),
  admin_code text unique check (admin_code is null or admin_code ~ '^[A-Z0-9]+-[0-9]{5,}$'),
  admin_title text not null check (char_length(btrim(admin_title)) > 0),
  status public.media_publication_status not null default 'draft',
  tmdb_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.series_seasons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id),
  internal_code text not null unique check (internal_code ~ '^SER-[0-9]{5,}-S[0-9]{2,}$'),
  admin_code text unique check (admin_code is null or admin_code ~ '^[A-Z0-9]+-[0-9]{5,}$'),
  admin_title text not null check (char_length(btrim(admin_title)) > 0),
  season_number integer not null check (season_number > 0 and season_number <= 99),
  status public.media_publication_status not null default 'draft',
  tmdb_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, season_number)
);

create table public.series_episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.series_seasons(id),
  internal_code text not null unique check (internal_code ~ '^SER-[0-9]{5,}-S[0-9]{2,}-E[0-9]{2,}$'),
  admin_code text unique check (admin_code is null or admin_code ~ '^[A-Z0-9]+-[0-9]{5,}$'),
  admin_title text not null check (char_length(btrim(admin_title)) > 0),
  episode_number integer not null check (episode_number > 0 and episode_number <= 99),
  status public.media_publication_status not null default 'draft',
  tmdb_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, episode_number)
);

create index movies_status_idx on public.movies(status);
create index series_status_idx on public.series(status);
create index series_seasons_series_status_number_idx on public.series_seasons(series_id, status, season_number);
create index series_episodes_season_status_number_idx on public.series_episodes(season_id, status, episode_number);

create or replace function public.validate_series_season_internal_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_series_code text;
  v_expected_code text;
begin
  select internal_code into v_series_code
  from public.series
  where id = new.series_id;

  v_expected_code := v_series_code || '-S' || lpad(new.season_number::text, 2, '0');
  if new.internal_code <> v_expected_code then
    raise exception 'Season internal_code must be %', v_expected_code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_media_internal_code_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.internal_code <> old.internal_code then
    raise exception 'internal_code is immutable once created'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

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
    || '-E' || lpad(new.episode_number::text, 2, '0');
  if new.internal_code <> v_expected_code then
    raise exception 'Episode internal_code must be %', v_expected_code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger series_seasons_validate_internal_code
before insert or update of series_id, internal_code, season_number on public.series_seasons
for each row execute function public.validate_series_season_internal_code();

create trigger series_episodes_validate_internal_code
before insert or update of season_id, internal_code, episode_number on public.series_episodes
for each row execute function public.validate_series_episode_internal_code();

create trigger movies_prevent_internal_code_change
before update of internal_code on public.movies
for each row execute function public.prevent_media_internal_code_change();
create trigger series_prevent_internal_code_change
before update of internal_code on public.series
for each row execute function public.prevent_media_internal_code_change();
create trigger series_seasons_prevent_internal_code_change
before update of internal_code on public.series_seasons
for each row execute function public.prevent_media_internal_code_change();
create trigger series_episodes_prevent_internal_code_change
before update of internal_code on public.series_episodes
for each row execute function public.prevent_media_internal_code_change();

create trigger movies_set_updated_at before update on public.movies
for each row execute function public.set_updated_at();
create trigger series_set_updated_at before update on public.series
for each row execute function public.set_updated_at();
create trigger series_seasons_set_updated_at before update on public.series_seasons
for each row execute function public.set_updated_at();
create trigger series_episodes_set_updated_at before update on public.series_episodes
for each row execute function public.set_updated_at();

create or replace function public.is_published_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.series
    where id = p_series_id
      and status = 'published'
  );
$$;

create or replace function public.is_published_series_season(p_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.series_seasons season
    join public.series series on series.id = season.series_id
    where season.id = p_season_id
      and season.status = 'published'
      and series.status = 'published'
  );
$$;

revoke all on function public.is_published_series(uuid) from public;
revoke all on function public.is_published_series_season(uuid) from public;
grant execute on function public.is_published_series(uuid) to authenticated;
grant execute on function public.is_published_series_season(uuid) to authenticated;

alter table public.movies enable row level security;
alter table public.series enable row level security;
alter table public.series_seasons enable row level security;
alter table public.series_episodes enable row level security;

create policy "Movie members read published movies"
on public.movies for select to authenticated
using (public.has_module_access('movies') and status = 'published');
create policy "Movie administrators read drafts"
on public.movies for select to authenticated
using (public.is_admin() and public.has_module_access('movies'));

create policy "Series members read published series"
on public.series for select to authenticated
using (public.has_module_access('series') and status = 'published');
create policy "Series administrators read drafts"
on public.series for select to authenticated
using (public.is_admin() and public.has_module_access('series'));

create policy "Series members read published seasons"
on public.series_seasons for select to authenticated
using (
  public.has_module_access('series')
  and status = 'published'
  and public.is_published_series(series_id)
);
create policy "Series administrators read draft seasons"
on public.series_seasons for select to authenticated
using (public.is_admin() and public.has_module_access('series'));

create policy "Series members read published episodes"
on public.series_episodes for select to authenticated
using (
  public.has_module_access('series')
  and status = 'published'
  and public.is_published_series_season(season_id)
);
create policy "Series administrators read draft episodes"
on public.series_episodes for select to authenticated
using (public.is_admin() and public.has_module_access('series'));

create policy "Admins insert movies" on public.movies
for insert to authenticated with check (public.is_admin());
create policy "Admins update movies" on public.movies
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins insert series" on public.series
for insert to authenticated with check (public.is_admin());
create policy "Admins update series" on public.series
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins insert series seasons" on public.series_seasons
for insert to authenticated with check (public.is_admin());
create policy "Admins update series seasons" on public.series_seasons
for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins insert series episodes" on public.series_episodes
for insert to authenticated with check (public.is_admin());
create policy "Admins update series episodes" on public.series_episodes
for update to authenticated using (public.is_admin()) with check (public.is_admin());

notify pgrst, 'reload schema';

commit;
