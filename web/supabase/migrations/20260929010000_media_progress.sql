begin;

create table public.media_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid not null references public.media_hls_packages(id) on delete cascade,
  position_seconds integer not null check (position_seconds >= 0),
  duration_seconds integer not null check (duration_seconds > 0 and position_seconds <= duration_seconds),
  watched_at timestamptz not null,
  primary key (user_id, package_id)
);
alter table public.media_progress enable row level security;
create policy "Users manage accessible media progress" on public.media_progress
for all to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.media_hls_packages p where p.id = package_id))
with check (user_id = (select auth.uid()) and exists (select 1 from public.media_hls_packages p where p.id = package_id));
grant select, insert, update, delete on public.media_progress to authenticated;

-- An older device or delayed exit request must never overwrite a newer view.
create function public.save_media_progress(p_package_id uuid, p_position integer, p_duration integer, p_watched_at timestamptz)
returns void language sql security invoker set search_path = '' as $$
  insert into public.media_progress(user_id, package_id, position_seconds, duration_seconds, watched_at)
  values ((select auth.uid()), p_package_id, p_position, p_duration, least(p_watched_at, now()))
  on conflict (user_id, package_id) do update
    set position_seconds = excluded.position_seconds, duration_seconds = excluded.duration_seconds, watched_at = excluded.watched_at
    where excluded.watched_at > media_progress.watched_at;
$$;
revoke all on function public.save_media_progress(uuid, integer, integer, timestamptz) from public;
grant execute on function public.save_media_progress(uuid, integer, integer, timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
