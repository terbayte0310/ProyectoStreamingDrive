-- Reverses 20260913050000_media_admin_commands.sql only.

begin;

drop function if exists public.next_movie_internal_code();
drop function if exists public.next_series_internal_code();
drop sequence if exists public.movie_internal_code_sequence;
drop sequence if exists public.series_internal_code_sequence;

notify pgrst, 'reload schema';

commit;
