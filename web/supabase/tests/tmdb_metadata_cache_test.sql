-- Run in the Supabase SQL Editor after 20260913040000_tmdb_metadata_cache.
-- It checks association integrity and reader visibility, then rolls back all
-- fixtures and temporary module-access changes.

begin;

do $$
declare
  v_reader_id uuid;
  v_movie_published_id uuid;
  v_movie_draft_id uuid;
begin
  select id into v_reader_id
  from public.profiles
  where is_authorized and role = 'reader'
  order by created_at
  limit 1;

  if v_reader_id is null then
    raise exception 'An authorised reader profile is required for this test';
  end if;

  insert into public.movies (internal_code, admin_code, admin_title, status)
  values ('MOV-94001', 'TMDBP-94001', 'TMDB published test movie', 'published')
  returning id into v_movie_published_id;
  insert into public.movies (internal_code, admin_code, admin_title, status)
  values ('MOV-94002', 'TMDBD-94002', 'TMDB draft test movie', 'draft')
  returning id into v_movie_draft_id;

  insert into public.media_tmdb_metadata (media_kind, movie_id, tmdb_id, tmdb_url, localized_title, genres, raw_payload, synced_at)
  values ('movie', v_movie_published_id, 994001, 'https://www.themoviedb.org/movie/994001', 'Published cached movie', '[{"id": 1, "name": "Test"}]', '{"id": 994001}', now());
  insert into public.media_tmdb_metadata (media_kind, movie_id, tmdb_id, tmdb_url, localized_title, genres, raw_payload, synced_at)
  values ('movie', v_movie_draft_id, 994002, 'https://www.themoviedb.org/movie/994002', 'Draft cached movie', '[]', '{"id": 994002}', now());

  begin
    insert into public.media_tmdb_metadata (media_kind, movie_id, series_id, genres)
    values ('movie', v_movie_published_id, gen_random_uuid(), '[]');
    raise exception 'TMDB metadata accepted more than one media parent';
  exception when check_violation then
    null;
  end;

  delete from public.user_module_access
  where user_id = v_reader_id and module = 'movies';
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', id::text, true)
from public.profiles
where is_authorized and role = 'reader'
order by created_at
limit 1;

set local role authenticated;

do $$
begin
  if exists (select 1 from public.media_tmdb_metadata) then
    raise exception 'A reader without Movies access can read cached TMDB metadata';
  end if;
end;
$$;

reset role;

insert into public.user_module_access (user_id, module)
select id, 'movies'
from public.profiles
where is_authorized and role = 'reader'
order by created_at
limit 1;

set local role authenticated;

do $$
declare
  v_updates integer;
begin
  if not exists (select 1 from public.media_tmdb_metadata where tmdb_id = 994001)
    or exists (select 1 from public.media_tmdb_metadata where tmdb_id = 994002) then
    raise exception 'TMDB cache visibility does not follow movie publication status';
  end if;

  update public.media_tmdb_metadata
  set localized_title = 'Reader must not update metadata'
  where tmdb_id = 994001;
  get diagnostics v_updates = row_count;
  if v_updates <> 0 then
    raise exception 'A reader updated TMDB metadata';
  end if;
end;
$$;

rollback;
