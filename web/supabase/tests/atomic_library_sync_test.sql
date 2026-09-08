-- Transactional contract test for reconcile_library_snapshot.
-- Safe to run in Supabase SQL Editor: every fixture is rolled back at the end.

begin;

do $$
declare
  v_admin_id uuid;
begin
  select id into v_admin_id
  from public.profiles
  where role = 'admin' and is_authorized
  order by created_at
  limit 1;

  if v_admin_id is null then
    raise exception 'The test requires one authorized admin profile';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

set local role authenticated;

do $$
declare
  v_admin_id uuid := auth.uid();
  v_course_id uuid;
  v_lesson_id uuid;
  v_run_id uuid;
  v_source_id uuid;
  v_summary jsonb;
  v_snapshot_initial jsonb := jsonb_build_array(
    jsonb_build_object('driveFileId', 'test-root', 'parentDriveFileId', null, 'kind', 'root', 'name', 'Test root', 'mimeType', 'application/vnd.google-apps.folder', 'byteSize', null, 'modifiedAt', null, 'detectedPosition', 0, 'isFolder', true, 'status', 'available', 'categoryDriveFileId', null, 'courseDriveFileId', null, 'parentSectionDriveFileId', null),
    jsonb_build_object('driveFileId', 'test-category', 'parentDriveFileId', 'test-root', 'kind', 'category', 'name', 'Category detected', 'mimeType', 'application/vnd.google-apps.folder', 'byteSize', null, 'modifiedAt', null, 'detectedPosition', 0, 'isFolder', true, 'status', 'available', 'categoryDriveFileId', 'test-category', 'courseDriveFileId', null, 'parentSectionDriveFileId', null),
    jsonb_build_object('driveFileId', 'test-course', 'parentDriveFileId', 'test-category', 'kind', 'course', 'name', 'Course detected', 'mimeType', 'application/vnd.google-apps.folder', 'byteSize', null, 'modifiedAt', null, 'detectedPosition', 0, 'isFolder', true, 'status', 'available', 'categoryDriveFileId', 'test-category', 'courseDriveFileId', 'test-course', 'parentSectionDriveFileId', null),
    jsonb_build_object('driveFileId', 'test-section', 'parentDriveFileId', 'test-course', 'kind', 'section', 'name', 'Section detected', 'mimeType', 'application/vnd.google-apps.folder', 'byteSize', null, 'modifiedAt', null, 'detectedPosition', 0, 'isFolder', true, 'status', 'available', 'categoryDriveFileId', 'test-category', 'courseDriveFileId', 'test-course', 'parentSectionDriveFileId', null),
    jsonb_build_object('driveFileId', 'test-lesson', 'parentDriveFileId', 'test-section', 'kind', 'lesson', 'name', 'Lesson detected.mp4', 'mimeType', 'video/mp4', 'byteSize', 1000, 'modifiedAt', '2026-09-07T00:00:00Z', 'detectedPosition', 0, 'isFolder', false, 'status', 'available', 'categoryDriveFileId', 'test-category', 'courseDriveFileId', 'test-course', 'parentSectionDriveFileId', 'test-section'),
    jsonb_build_object('driveFileId', 'test-unsupported', 'parentDriveFileId', 'test-course', 'kind', 'unsupported', 'name', 'Guide.pdf', 'mimeType', 'application/pdf', 'byteSize', 200, 'modifiedAt', null, 'detectedPosition', 1, 'isFolder', false, 'status', 'unsupported', 'categoryDriveFileId', 'test-category', 'courseDriveFileId', 'test-course', 'parentSectionDriveFileId', null)
  );
  v_snapshot_changed jsonb;
begin
  insert into public.library_sources (name, drive_root_folder_id)
  values ('Atomic sync transaction test', 'test-root')
  returning id into v_source_id;

  insert into public.catalog_sync_runs (source_id, status, initiated_by)
  values (v_source_id, 'running', v_admin_id)
  returning id into v_run_id;

  v_summary := public.reconcile_library_snapshot(v_source_id, v_run_id, v_snapshot_initial);
  if v_summary->>'new' <> '6' or v_summary->>'lessons' <> '1' or v_summary->>'unsupported' <> '1' then
    raise exception 'Unexpected first synchronization summary: %', v_summary;
  end if;

  select course.id into strict v_course_id
  from public.courses course
  join public.drive_items item on item.id = course.drive_item_id
  where item.source_id = v_source_id and item.drive_file_id = 'test-course';

  select lesson.id into strict v_lesson_id
  from public.lessons lesson
  join public.drive_items item on item.id = lesson.drive_item_id
  where item.source_id = v_source_id and item.drive_file_id = 'test-lesson';

  update public.courses set custom_title = 'Manual course title', position = 77 where id = v_course_id;
  insert into public.lesson_progress (user_id, lesson_id, position_seconds, duration_seconds, state)
  values (v_admin_id, v_lesson_id, 42, 100, 'in_progress');
  insert into public.lesson_notes (user_id, lesson_id, timestamp_seconds, body)
  values (v_admin_id, v_lesson_id, 42, 'Transactional sync test note');

  insert into public.catalog_sync_runs (source_id, status, initiated_by)
  values (v_source_id, 'running', v_admin_id)
  returning id into v_run_id;
  v_summary := public.reconcile_library_snapshot(v_source_id, v_run_id, v_snapshot_initial);

  if v_summary->>'new' <> '0' or v_summary->>'updated' <> '0' or v_summary->>'missing' <> '0' then
    raise exception 'The identical snapshot was not idempotent: %', v_summary;
  end if;
  if not exists (select 1 from public.courses where id = v_course_id and custom_title = 'Manual course title' and position = 77) then
    raise exception 'The identical snapshot overwrote manual course fields';
  end if;

  select jsonb_agg(
    case
      when item->>'driveFileId' = 'test-course' then item || jsonb_build_object('name', 'Course renamed in Drive', 'detectedPosition', 9)
      else item
    end
  )
  into v_snapshot_changed
  from jsonb_array_elements(v_snapshot_initial) entry(item)
  where item->>'driveFileId' <> 'test-lesson';

  insert into public.catalog_sync_runs (source_id, status, initiated_by)
  values (v_source_id, 'running', v_admin_id)
  returning id into v_run_id;
  v_summary := public.reconcile_library_snapshot(v_source_id, v_run_id, v_snapshot_changed);

  if v_summary->>'missing' <> '1' then
    raise exception 'The omitted lesson was not marked missing: %', v_summary;
  end if;
  if not exists (
    select 1 from public.courses
    where id = v_course_id
      and detected_title = 'Course renamed in Drive'
      and detected_position = 9
      and custom_title = 'Manual course title'
      and position = 77
  ) then
    raise exception 'Detected fields or manual overrides were reconciled incorrectly';
  end if;
  if not exists (select 1 from public.lesson_progress where user_id = v_admin_id and lesson_id = v_lesson_id and position_seconds = 42)
    or not exists (select 1 from public.lesson_notes where user_id = v_admin_id and lesson_id = v_lesson_id and body = 'Transactional sync test note') then
    raise exception 'Missing Drive items destroyed private lesson data';
  end if;

  insert into public.catalog_sync_runs (source_id, status, initiated_by)
  values (v_source_id, 'running', v_admin_id)
  returning id into v_run_id;
  v_summary := public.reconcile_library_snapshot(v_source_id, v_run_id, v_snapshot_initial);

  if v_summary->>'restored' <> '1' or v_summary->>'missing' <> '0' then
    raise exception 'The lesson was not restored correctly: %', v_summary;
  end if;
  if not exists (select 1 from public.lessons where id = v_lesson_id)
    or not exists (select 1 from public.lesson_progress where user_id = v_admin_id and lesson_id = v_lesson_id)
    or not exists (select 1 from public.lesson_notes where user_id = v_admin_id and lesson_id = v_lesson_id) then
    raise exception 'Restoring the item changed its identity or private data';
  end if;

  raise notice 'PASS atomic_library_sync_test: %', v_summary;
end;
$$;

reset role;
rollback;
