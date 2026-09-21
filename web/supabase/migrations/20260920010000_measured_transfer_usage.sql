-- Separate observed delivery from conservative transfer reservations.
-- Drive sends bytes directly to the browser, so this records bytes actually
-- read by the Service Worker; it never claims to be a Google billing ledger.

begin;

alter table public.transfer_usage_buckets
  add column observed_bytes bigint not null default 0 check (observed_bytes >= 0),
  add column completed_delivery_count bigint not null default 0 check (completed_delivery_count >= 0),
  add column cancelled_delivery_count bigint not null default 0 check (cancelled_delivery_count >= 0),
  add column failed_delivery_count bigint not null default 0 check (failed_delivery_count >= 0);

alter table public.transfer_usage_reservations
  add column module text not null default 'unknown'
  check (module in ('courses', 'media', 'unknown'));

create table public.transfer_usage_module_buckets (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket_start timestamptz not null,
  module text not null check (module in ('courses', 'media')),
  observed_bytes bigint not null default 0 check (observed_bytes >= 0),
  completed_delivery_count bigint not null default 0 check (completed_delivery_count >= 0),
  cancelled_delivery_count bigint not null default 0 check (cancelled_delivery_count >= 0),
  failed_delivery_count bigint not null default 0 check (failed_delivery_count >= 0),
  primary key (user_id, bucket_start, module),
  foreign key (user_id, bucket_start)
    references public.transfer_usage_buckets(user_id, bucket_start)
    on delete cascade
);

create index transfer_usage_module_buckets_time_idx
  on public.transfer_usage_module_buckets(bucket_start, module);

alter table public.transfer_usage_module_buckets enable row level security;

create policy "Admins read transfer usage settings"
on public.transfer_usage_settings for select to authenticated
using (public.is_admin());

create policy "Admins read transfer usage buckets"
on public.transfer_usage_buckets for select to authenticated
using (public.is_admin());

create policy "Admins read transfer usage module buckets"
on public.transfer_usage_module_buckets for select to authenticated
using (public.is_admin());

drop function public.reserve_transfer_usage(bigint);

create function public.reserve_transfer_usage(
  p_request_bytes bigint,
  p_module text default 'unknown'
)
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
  v_module text := coalesce(p_module, 'unknown');
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles where id = v_user_id and is_authorized
  ) then
    raise insufficient_privilege using message = 'Authorized account required';
  end if;
  if p_request_bytes is null or p_request_bytes <= 0 then
    raise invalid_parameter_value using message = 'Transfer size must be positive';
  end if;
  if v_module not in ('courses', 'media', 'unknown') then
    v_module := 'unknown';
  end if;

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
      false, null::uuid,
      v_user_used >= v_settings.user_warning_bytes,
      v_global_used >= v_settings.global_warning_bytes,
      v_user_used, v_global_used,
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

  insert into public.transfer_usage_reservations (user_id, bucket_start, reserved_bytes, module)
  values (v_user_id, v_bucket_start, p_request_bytes, v_module)
  returning id into v_reservation_id;

  v_user_used := v_user_used + p_request_bytes;
  v_global_used := v_global_used + p_request_bytes;

  return query select
    true, v_reservation_id,
    v_user_used >= v_settings.user_warning_bytes,
    v_global_used >= v_settings.global_warning_bytes,
    v_user_used, v_global_used, 0,
    v_settings.user_warning_bytes,
    v_settings.global_warning_bytes,
    v_settings.global_emergency_bytes;
end;
$$;

drop function public.confirm_transfer_usage(uuid);

create function public.confirm_transfer_usage(
  p_reservation_id uuid,
  p_observed_bytes bigint default null,
  p_outcome text default 'completed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_bucket_start timestamptz;
  v_reserved_bytes bigint;
  v_module text;
  v_observed_bytes bigint;
  v_outcome text := coalesce(p_outcome, 'failed');
begin
  delete from public.transfer_usage_reservations
  where id = p_reservation_id and user_id = v_user_id
  returning bucket_start, reserved_bytes, module
  into v_bucket_start, v_reserved_bytes, v_module;

  if not found then return false; end if;
  if v_outcome not in ('completed', 'cancelled', 'failed') then v_outcome := 'failed'; end if;
  v_observed_bytes := greatest(0, least(coalesce(p_observed_bytes, v_reserved_bytes), v_reserved_bytes));

  update public.transfer_usage_buckets
  set
    confirmed_bytes = confirmed_bytes + v_observed_bytes,
    observed_bytes = observed_bytes + v_observed_bytes,
    released_bytes = released_bytes + (v_reserved_bytes - v_observed_bytes),
    completed_delivery_count = completed_delivery_count + case when v_outcome = 'completed' then 1 else 0 end,
    cancelled_delivery_count = cancelled_delivery_count + case when v_outcome = 'cancelled' then 1 else 0 end,
    failed_delivery_count = failed_delivery_count + case when v_outcome = 'failed' then 1 else 0 end
  where user_id = v_user_id and bucket_start = v_bucket_start;

  if v_module in ('courses', 'media') then
    insert into public.transfer_usage_module_buckets (
      user_id, bucket_start, module, observed_bytes,
      completed_delivery_count, cancelled_delivery_count, failed_delivery_count
    ) values (
      v_user_id, v_bucket_start, v_module, v_observed_bytes,
      case when v_outcome = 'completed' then 1 else 0 end,
      case when v_outcome = 'cancelled' then 1 else 0 end,
      case when v_outcome = 'failed' then 1 else 0 end
    )
    on conflict (user_id, bucket_start, module) do update set
      observed_bytes = public.transfer_usage_module_buckets.observed_bytes + excluded.observed_bytes,
      completed_delivery_count = public.transfer_usage_module_buckets.completed_delivery_count + excluded.completed_delivery_count,
      cancelled_delivery_count = public.transfer_usage_module_buckets.cancelled_delivery_count + excluded.cancelled_delivery_count,
      failed_delivery_count = public.transfer_usage_module_buckets.failed_delivery_count + excluded.failed_delivery_count;
  end if;

  return true;
end;
$$;

revoke all on function public.reserve_transfer_usage(bigint, text) from public;
revoke all on function public.confirm_transfer_usage(uuid, bigint, text) from public;
grant execute on function public.reserve_transfer_usage(bigint, text) to authenticated;
grant execute on function public.confirm_transfer_usage(uuid, bigint, text) to authenticated;

notify pgrst, 'reload schema';

commit;
