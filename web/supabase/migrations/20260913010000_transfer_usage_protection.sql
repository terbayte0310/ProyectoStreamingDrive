-- Prevent runaway Drive transfers without interrupting normal family use.
-- Video bytes continue to travel directly from Drive to the user's device.

begin;

create table public.transfer_usage_settings (
  id smallint primary key default 1 check (id = 1),
  user_warning_bytes bigint not null check (user_warning_bytes > 0),
  global_warning_bytes bigint not null check (global_warning_bytes >= user_warning_bytes),
  global_emergency_bytes bigint not null check (global_emergency_bytes > global_warning_bytes),
  retention_days integer not null default 30 check (retention_days between 1 and 365)
);

insert into public.transfer_usage_settings (
  id,
  user_warning_bytes,
  global_warning_bytes,
  global_emergency_bytes,
  retention_days
) values (
  1,
  26843545600,  -- 25 GiB: non-blocking per-user warning
  161061273600, -- 150 GiB: non-blocking global warning
  805306368000, -- 750 GiB: global emergency fuse
  30
);

create table public.transfer_usage_buckets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket_start timestamptz not null,
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  confirmed_bytes bigint not null default 0 check (confirmed_bytes >= 0),
  released_bytes bigint not null default 0 check (released_bytes >= 0),
  rejected_bytes bigint not null default 0 check (rejected_bytes >= 0),
  rejection_count bigint not null default 0 check (rejection_count >= 0),
  last_rejection_reason text,
  primary key (user_id, bucket_start)
);

create table public.transfer_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  bucket_start timestamptz not null,
  reserved_bytes bigint not null check (reserved_bytes > 0),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  foreign key (user_id, bucket_start)
    references public.transfer_usage_buckets(user_id, bucket_start)
    on delete cascade
);

create index transfer_usage_buckets_time_idx on public.transfer_usage_buckets(bucket_start);
create index transfer_usage_reservations_expiry_idx on public.transfer_usage_reservations(expires_at);

alter table public.transfer_usage_settings enable row level security;
alter table public.transfer_usage_buckets enable row level security;
alter table public.transfer_usage_reservations enable row level security;

create or replace function public.reconcile_expired_transfer_reservations()
returns void
language sql
security definer
set search_path = public
as $$
  with expired as (
    delete from public.transfer_usage_reservations
    where expires_at <= now()
    returning user_id, bucket_start, reserved_bytes
  ), released as (
    select user_id, bucket_start, sum(reserved_bytes)::bigint as released_bytes
    from expired
    group by user_id, bucket_start
  )
  update public.transfer_usage_buckets bucket
  set released_bytes = bucket.released_bytes + released.released_bytes
  from released
  where bucket.user_id = released.user_id
    and bucket.bucket_start = released.bucket_start;
$$;

revoke all on function public.reconcile_expired_transfer_reservations() from public;

create or replace function public.reserve_transfer_usage(p_request_bytes bigint)
returns table (
  allowed boolean,
  reservation_id uuid,
  user_warning boolean,
  global_warning boolean,
  user_used_bytes bigint,
  global_used_bytes bigint,
  retry_after_seconds integer,
  user_warning_limit_bytes bigint,
  global_warning_limit_bytes bigint,
  emergency_limit_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bucket_start timestamptz := date_trunc('hour', now());
  v_window_start timestamptz := date_trunc('hour', now() - interval '24 hours');
  v_settings public.transfer_usage_settings%rowtype;
  v_user_used bigint;
  v_global_used bigint;
  v_reservation_id uuid;
  v_oldest_bucket timestamptz;
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles where id = v_user_id and is_authorized
  ) then
    raise insufficient_privilege using message = 'Authorized account required';
  end if;
  if p_request_bytes is null or p_request_bytes <= 0 then
    raise invalid_parameter_value using message = 'Transfer size must be positive';
  end if;

  -- Six users share one global budget, so a transaction-level lock keeps the
  -- read/check/write sequence atomic even when devices request ranges together.
  perform pg_advisory_xact_lock(7046029254386353131);
  perform public.reconcile_expired_transfer_reservations();

  select * into strict v_settings from public.transfer_usage_settings where id = 1;

  delete from public.transfer_usage_buckets
  where bucket_start < date_trunc('hour', now() - make_interval(days => v_settings.retention_days));

  select coalesce(sum(greatest(reserved_bytes - released_bytes, 0)), 0)::bigint
  into v_user_used
  from public.transfer_usage_buckets
  where user_id = v_user_id and bucket_start >= v_window_start;

  select
    coalesce(sum(greatest(reserved_bytes - released_bytes, 0)), 0)::bigint,
    min(bucket_start)
  into v_global_used, v_oldest_bucket
  from public.transfer_usage_buckets
  where bucket_start >= v_window_start;

  if v_global_used + p_request_bytes > v_settings.global_emergency_bytes then
    insert into public.transfer_usage_buckets (
      user_id, bucket_start, rejected_bytes, rejection_count, last_rejection_reason
    ) values (
      v_user_id, v_bucket_start, p_request_bytes, 1, 'global_emergency_fuse'
    )
    on conflict (user_id, bucket_start) do update set
      rejected_bytes = public.transfer_usage_buckets.rejected_bytes + excluded.rejected_bytes,
      rejection_count = public.transfer_usage_buckets.rejection_count + 1,
      last_rejection_reason = excluded.last_rejection_reason;

    return query select
      false,
      null::uuid,
      v_user_used >= v_settings.user_warning_bytes,
      v_global_used >= v_settings.global_warning_bytes,
      v_user_used,
      v_global_used,
      greatest(60, ceil(extract(epoch from (
        coalesce(v_oldest_bucket + interval '25 hours', now() + interval '1 hour') - now()
      )))::integer),
      v_settings.user_warning_bytes,
      v_settings.global_warning_bytes,
      v_settings.global_emergency_bytes;
    return;
  end if;

  insert into public.transfer_usage_buckets (user_id, bucket_start, reserved_bytes)
  values (v_user_id, v_bucket_start, p_request_bytes)
  on conflict (user_id, bucket_start) do update set
    reserved_bytes = public.transfer_usage_buckets.reserved_bytes + excluded.reserved_bytes;

  insert into public.transfer_usage_reservations (user_id, bucket_start, reserved_bytes)
  values (v_user_id, v_bucket_start, p_request_bytes)
  returning id into v_reservation_id;

  v_user_used := v_user_used + p_request_bytes;
  v_global_used := v_global_used + p_request_bytes;

  return query select
    true,
    v_reservation_id,
    v_user_used >= v_settings.user_warning_bytes,
    v_global_used >= v_settings.global_warning_bytes,
    v_user_used,
    v_global_used,
    0,
    v_settings.user_warning_bytes,
    v_settings.global_warning_bytes,
    v_settings.global_emergency_bytes;
end;
$$;

create or replace function public.confirm_transfer_usage(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bucket_start timestamptz;
  v_reserved_bytes bigint;
begin
  delete from public.transfer_usage_reservations
  where id = p_reservation_id and user_id = v_user_id
  returning bucket_start, reserved_bytes into v_bucket_start, v_reserved_bytes;

  if not found then return false; end if;

  update public.transfer_usage_buckets
  set confirmed_bytes = confirmed_bytes + v_reserved_bytes
  where user_id = v_user_id and bucket_start = v_bucket_start;
  return true;
end;
$$;

create or replace function public.release_transfer_usage(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bucket_start timestamptz;
  v_reserved_bytes bigint;
begin
  delete from public.transfer_usage_reservations
  where id = p_reservation_id and user_id = v_user_id
  returning bucket_start, reserved_bytes into v_bucket_start, v_reserved_bytes;

  if not found then return false; end if;

  update public.transfer_usage_buckets
  set released_bytes = released_bytes + v_reserved_bytes
  where user_id = v_user_id and bucket_start = v_bucket_start;
  return true;
end;
$$;

revoke all on function public.reserve_transfer_usage(bigint) from public;
revoke all on function public.confirm_transfer_usage(uuid) from public;
revoke all on function public.release_transfer_usage(uuid) from public;
grant execute on function public.reserve_transfer_usage(bigint) to authenticated;
grant execute on function public.confirm_transfer_usage(uuid) to authenticated;
grant execute on function public.release_transfer_usage(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
