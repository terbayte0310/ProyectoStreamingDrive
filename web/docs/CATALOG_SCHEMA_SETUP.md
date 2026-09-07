# Crear el esquema del catálogo

## Qué crea esta migración

`supabase/migrations/20260906230000_catalog_foundation.sql` crea la base de datos de la aplicación, no una copia de tus videos.

| Tabla | Responsabilidad |
| --- | --- |
| `library_sources` y `drive_items` | Lo detectado al leer Drive. |
| `categories`, `courses`, `course_sections`, `lessons` | El catálogo educativo editable. |
| `lesson_progress`, `lesson_notes`, `user_preferences` | Datos privados de cada persona. |
| `catalog_sync_runs` | Historial de importaciones y errores. |

La tabla `drive_items` permite ignorar `desktop.ini` sin eliminarlo de Drive. Las tablas educativas se vinculan por ID de Drive, no por nombre: renombrar un archivo o carpeta no elimina su progreso, notas o portada.

## Aplicarla en Supabase

1. Abre tu proyecto de Supabase → **SQL Editor** → **New query**.
2. Copia el contenido completo de `supabase/migrations/20260906230000_catalog_foundation.sql`.
3. Pulsa **Run**.
4. Debes ver `Success. No rows returned`.

No ejecutes todavía ningún `insert`: la primera sincronización creará la fuente de biblioteca y el contenido detectado.
