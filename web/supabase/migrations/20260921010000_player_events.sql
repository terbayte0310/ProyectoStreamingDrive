-- Diagnóstico del reproductor: eventos mínimos (reinicios, fallos de sesión,
-- latidos) para saber por qué se corta una reproducción en un dispositivo real.
-- Cada usuario solo puede insertar los suyos; solo un administrador los lee.

begin;

create table if not exists public.player_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  client_time timestamptz,
  package_id uuid,
  event text not null check (char_length(event) between 1 and 40),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 2048),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300)
);

create index if not exists player_events_created_idx on public.player_events (created_at desc);
create index if not exists player_events_user_idx on public.player_events (user_id, created_at desc);

alter table public.player_events enable row level security;

drop policy if exists "player_events_insert_own" on public.player_events;
create policy "player_events_insert_own" on public.player_events
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "player_events_admin_read" on public.player_events;
create policy "player_events_admin_read" on public.player_events
  for select to authenticated
  using (public.is_admin());

revoke all on public.player_events from anon;
grant insert on public.player_events to authenticated;
grant select on public.player_events to authenticated;

notify pgrst, 'reload schema';

commit;
