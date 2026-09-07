import type { SupabaseClient } from "@supabase/supabase-js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ignoredNames = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type DriveFile = {
  id: string;
  mimeType: string;
  modifiedTime?: string;
  name: string;
  size?: string;
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
};

type ImportCounters = {
  files: number;
  folders: number;
  ignored: number;
};

function isIgnored(file: DriveFile) {
  return ignoredNames.has(file.name.toLowerCase()) || file.name.startsWith(".");
}

function isPlayable(file: DriveFile) {
  return file.mimeType.startsWith("video/") || file.mimeType.startsWith("audio/");
}

async function listChildren(accessToken: string, parentId: string) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      orderBy: "folder,name_natural",
      pageSize: "1000",
      q: `'${parentId}' in parents and trashed = false`,
    });
    if (pageToken) query.set("pageToken", pageToken);

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error("Drive rechazó la lectura de una carpeta.");

    const data = (await response.json()) as DriveListResponse;
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files.sort((a, b) => naturalOrder.compare(a.name, b.name));
}

async function upsertDriveItem(
  supabase: SupabaseClient,
  sourceId: string,
  file: DriveFile,
  parentDriveFileId: string | null,
  status: "available" | "ignored" = "available",
) {
  const { data, error } = await supabase
    .from("drive_items")
    .upsert(
      {
        byte_size: file.size ? Number(file.size) : null,
        detected_name: file.name,
        drive_file_id: file.id,
        is_folder: file.mimeType === FOLDER_MIME_TYPE,
        last_seen_at: new Date().toISOString(),
        mime_type: file.mimeType,
        modified_at_drive: file.modifiedTime ?? null,
        parent_drive_file_id: parentDriveFileId,
        source_id: sourceId,
        status,
      },
      { onConflict: "source_id,drive_file_id" },
    )
    .select("id")
    .single<{ id: string }>();

  if (error || !data) throw new Error("No se pudo registrar un elemento detectado de Drive.");
  return data.id;
}

export async function importAwsPilotCatalog({
  accessToken,
  rootFolderId,
  supabase,
}: {
  accessToken: string;
  rootFolderId: string;
  supabase: SupabaseClient;
}) {
  const counters: ImportCounters = { files: 0, folders: 0, ignored: 0 };
  const { data: source, error: sourceError } = await supabase
    .from("library_sources")
    .upsert(
      { drive_root_folder_id: rootFolderId, name: "AWS (prueba de importación)", last_scan_status: "running" },
      { onConflict: "drive_root_folder_id" },
    )
    .select("id")
    .single<{ id: string }>();
  if (sourceError || !source) throw new Error("No se pudo iniciar la fuente de biblioteca.");

  const { data: run, error: runError } = await supabase
    .from("catalog_sync_runs")
    .insert({ source_id: source.id, status: "running" })
    .select("id")
    .single<{ id: string }>();
  if (runError || !run) throw new Error("No se pudo registrar la sincronización.");

  try {
    const rootItemId = await upsertDriveItem(
      supabase,
      source.id,
      { id: rootFolderId, mimeType: FOLDER_MIME_TYPE, name: "AWS" },
      null,
    );
    counters.folders += 1;

    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .upsert(
        { detected_title: "AWS", drive_item_id: rootItemId, source_id: source.id },
        { onConflict: "drive_item_id" },
      )
      .select("id")
      .single<{ id: string }>();
    if (categoryError || !category) throw new Error("No se pudo crear la categoría AWS.");

    const rootChildren = await listChildren(accessToken, rootFolderId);
    for (let coursePosition = 0; coursePosition < rootChildren.length; coursePosition += 1) {
      const child = rootChildren[coursePosition];
      if (isIgnored(child)) {
        await upsertDriveItem(supabase, source.id, child, rootFolderId, "ignored");
        counters.ignored += 1;
        continue;
      }
      if (child.mimeType !== FOLDER_MIME_TYPE) {
        await upsertDriveItem(supabase, source.id, child, rootFolderId);
        counters.files += 1;
        continue;
      }

      const courseItemId = await upsertDriveItem(supabase, source.id, child, rootFolderId);
      counters.folders += 1;
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .upsert(
          { category_id: category.id, detected_title: child.name, drive_item_id: courseItemId, position: coursePosition },
          { onConflict: "drive_item_id" },
        )
        .select("id")
        .single<{ id: string }>();
      if (courseError || !course) throw new Error("No se pudo crear un curso detectado.");

      await importCourseChildren({
        accessToken,
        counters,
        courseId: course.id,
        parentDriveFileId: child.id,
        parentSectionId: null,
        sourceId: source.id,
        supabase,
      });
    }

    await supabase
      .from("catalog_sync_runs")
      .update({ files_seen: counters.files, finished_at: new Date().toISOString(), folders_seen: counters.folders, ignored_items: counters.ignored, status: "completed" })
      .eq("id", run.id);
    await supabase
      .from("library_sources")
      .update({ last_scanned_at: new Date().toISOString(), last_scan_status: "completed" })
      .eq("id", source.id);

    return counters;
  } catch (error) {
    await supabase
      .from("catalog_sync_runs")
      .update({ error_summary: error instanceof Error ? error.message : "Error desconocido", finished_at: new Date().toISOString(), status: "failed" })
      .eq("id", run.id);
    await supabase.from("library_sources").update({ last_scan_status: "failed" }).eq("id", source.id);
    throw error;
  }
}

async function importCourseChildren({
  accessToken,
  counters,
  courseId,
  parentDriveFileId,
  parentSectionId,
  sourceId,
  supabase,
}: {
  accessToken: string;
  counters: ImportCounters;
  courseId: string;
  parentDriveFileId: string;
  parentSectionId: string | null;
  sourceId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  const children = await listChildren(accessToken, parentDriveFileId);
  for (let position = 0; position < children.length; position += 1) {
    const child = children[position];
    if (isIgnored(child)) {
      await upsertDriveItem(supabase, sourceId, child, parentDriveFileId, "ignored");
      counters.ignored += 1;
      continue;
    }

    const itemId = await upsertDriveItem(supabase, sourceId, child, parentDriveFileId);
    if (child.mimeType === FOLDER_MIME_TYPE) {
      counters.folders += 1;
      const { data: section, error } = await supabase
        .from("course_sections")
        .upsert(
          { course_id: courseId, detected_position: position, detected_title: child.name, drive_item_id: itemId, parent_section_id: parentSectionId },
          { onConflict: "drive_item_id" },
        )
        .select("id")
        .single<{ id: string }>();
      if (error || !section) throw new Error("No se pudo crear una sección detectada.");
      await importCourseChildren({ accessToken, counters, courseId, parentDriveFileId: child.id, parentSectionId: section.id, sourceId, supabase });
      continue;
    }

    counters.files += 1;
    if (!isPlayable(child)) continue;
    const { error } = await supabase.from("lessons").upsert(
      {
        course_id: courseId,
        detected_title: child.name,
        drive_item_id: itemId,
        media_type: child.mimeType.startsWith("audio/") ? "audio" : "video",
        detected_position: position,
        section_id: parentSectionId,
      },
      { onConflict: "drive_item_id" },
    );
    if (error) throw new Error("No se pudo crear una lección detectada.");
  }
}
