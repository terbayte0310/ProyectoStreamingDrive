-- Reverses 20260913060000_media_hls_playback.sql only.

begin;

alter table if exists public.media_hls_packages drop constraint if exists media_hls_packages_manifest_asset_id_fkey;
drop table if exists public.media_hls_assets;
drop table if exists public.media_hls_packages;
drop table if exists public.media_drive_sources;
drop function if exists public.validate_media_hls_manifest_asset();
drop function if exists public.media_hls_package_is_playable(uuid);
drop type if exists public.media_hls_asset_kind;
drop type if exists public.media_hls_package_status;

notify pgrst, 'reload schema';

commit;
