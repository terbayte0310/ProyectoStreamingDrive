# Migrador local de paquetes HLS

Este migrador indexa una vez los archivos HLS ya subidos a Google Drive y escribe la relación `ruta relativa -> ID de archivo de Drive` en Supabase. No modifica, mueve ni borra archivos de Drive.

## Seguridad

El script necesita una identidad de Google con alcance de solo lectura sobre la biblioteca y `SUPABASE_SECRET_KEY` (o la antigua `SUPABASE_SERVICE_ROLE_KEY`) para escribir en las tablas de administración. Ambas credenciales permanecen en `.env.local`, ignorado por Git. Los reportes locales se guardan en `scripts/output/`, también ignorado.

La opción recomendada es una cuenta de servicio de Google Cloud: comparte únicamente la carpeta raíz `100_BIBLIOTECA_ENTRETENIMIENTO` con el correo de la cuenta de servicio como **Lector**, descarga su clave JSON fuera del repositorio y configura `GOOGLE_APPLICATION_CREDENTIALS` con su ruta absoluta. Alternativamente, configura `GOOGLE_DRIVE_REFRESH_TOKEN` junto con el client ID y secreto existentes.

## Preparación

En `web/.env.local`, añade:

```dotenv
SUPABASE_SECRET_KEY=...
HLS_DRIVE_ROOT_FOLDER_ID=<id-de-la-carpeta-raiz-hls>
GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\privada\drive-reader-service-account.json
```

La fuente con ese ID debe existir y estar activa en `media_drive_sources`.

## Uso

Desde `web`:

```powershell
npm run media:migrate:dry
npm run media:migrate -- --limit 2
npm run media:migrate
```

Para una carpeta específica:

```powershell
npm run media:migrate -- --code MOV-00007
```

El modo normal salta paquetes `ready` cuya carpeta no cambió. Si se corta, vuelve a ejecutar el mismo comando; solo atenderá los pendientes. `--rescan` fuerza volver a leer incluso los paquetes ya listos.

El archivo `scripts/output/hls-drive-map.jsonl` es un respaldo local del mapa de IDs por paquete y `scripts/output/hls-migration-last-run.json` muestra el último avance, errores y códigos sin correspondencia en el catálogo.