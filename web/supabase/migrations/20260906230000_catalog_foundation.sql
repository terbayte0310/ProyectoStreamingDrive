-- Catalog foundation. Drive remains the source of files; this database stores
-- the normalized, editable learning catalog and each person's private state.

begin;

create type public.drive_item_status as enum ('available', 'missing', 'ignored', 'unsupported');
create type public.lesson_media_type as enum ('video', 'audio', 'document', 'resource');
create type public.progress_state as enum ('not_started', 'in_progress', 'completed');

create or replace function public.is_authorized_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_authorized
  );
$$;

revoke all on function public.is_authorized_user() from public;
grant execute on function public.is_authorized_user() to authenticated;

create table public.library_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  drive_root_folder_id text not null unique,
  is_active boolean not null default true,
  last_scanned_at timestamptz,
  last_scan_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drive_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.library_sources(id) on delete cascade,
  drive_file_id text not null,
  parent_drive_file_id text,
  detected_name text not null,
  mime_type text not null,
  byte_size bigint,
  modified_at_drive timestamptz,
  is_folder boolean not null default false,
  status public.drive_item_status not null default 'available',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, drive_file_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.library_sources(id) on delete cascade,
  drive_item_id uuid unique references public.drive_items(id) on delete set null,
  detected_title text not null,
  custom_title text,
  position integer not null default 0,
  is_visible boolean not null default true,
  cover_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  drive_item_id uuid unique references public.drive_items(id) on delete set null,
  detected_title text not null,
  custom_title text,
  author text,
  platform text,
  published_on date,
  description text,
  position integer not null default 0,
  is_visible boolean not null default true,
  cover_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  drive_item_id uuid unique references public.drive_items(id) on delete set null,
  parent_section_id uuid references public.course_sections(id) on delete cascade,
  detected_title text not null,
  custom_title text,
  position integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  section_id uuid references public.course_sections(id) on delete set null,
  drive_item_id uuid unique references public.drive_items(id) on delete set null,
  detected_title text not null,
  custom_title text,
  media_type public.lesson_media_type not null default 'video',
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  position integer not null default 0,
  is_visible boolean not null default true,
  is_downloadable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  position_seconds integer not null default 0 check (position_seconds >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  state public.progress_state not null default 'not_started',
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  timestamp_seconds integer not null default 0 check (timestamp_seconds >= 0),
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  autoplay_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.library_sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'completed', 'failed')),
  folders_seen integer not null default 0,
  files_seen integer not null default 0,
  ignored_items integer not null default 0,
  error_summary text,
  initiated_by uuid references public.profiles(id) on delete set null
);

create index drive_items_source_parent_idx on public.drive_items(source_id, parent_drive_file_id);
create index courses_category_position_idx on public.courses(category_id, position);
create index course_sections_course_parent_position_idx on public.course_sections(course_id, parent_section_id, position);
create index lessons_course_section_position_idx on public.lessons(course_id, section_id, position);
create index lesson_progress_user_updated_idx on public.lesson_progress(user_id, updated_at desc);
create index lesson_notes_user_lesson_timestamp_idx on public.lesson_notes(user_id, lesson_id, timestamp_seconds);

create trigger library_sources_set_updated_at before update on public.library_sources for each row execute function public.set_updated_at();
create trigger drive_items_set_updated_at before update on public.drive_items for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses for each row execute function public.set_updated_at();
create trigger course_sections_set_updated_at before update on public.course_sections for each row execute function public.set_updated_at();
create trigger lessons_set_updated_at before update on public.lessons for each row execute function public.set_updated_at();
create trigger lesson_notes_set_updated_at before update on public.lesson_notes for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();

alter table public.library_sources enable row level security;
alter table public.drive_items enable row level security;
alter table public.categories enable row level security;
alter table public.courses enable row level security;
alter table public.course_sections enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.lesson_notes enable row level security;
alter table public.user_preferences enable row level security;
alter table public.catalog_sync_runs enable row level security;

create policy "Authorized users can read library sources" on public.library_sources for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read drive items" on public.drive_items for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read categories" on public.categories for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read courses" on public.courses for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read course sections" on public.course_sections for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read lessons" on public.lessons for select to authenticated using (public.is_authorized_user());
create policy "Authorized users can read sync runs" on public.catalog_sync_runs for select to authenticated using (public.is_authorized_user());

create policy "Admins manage library sources" on public.library_sources for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage drive items" on public.drive_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage courses" on public.courses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage course sections" on public.course_sections for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage lessons" on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins manage sync runs" on public.catalog_sync_runs for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Users manage their own progress" on public.lesson_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their own notes" on public.lesson_notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users manage their own preferences" on public.user_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;
