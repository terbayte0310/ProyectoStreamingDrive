# Sincronización durable de Drive desde el PC

La aplicación desplegada puede seguir reproduciendo y editando metadatos desde Vercel. Las importaciones masivas se ejecutan localmente para no depender del límite de duración de una función web.

## Preparación única

1. Aplicar, en orden, las migraciones `supabase/migrations/20260909020000_durable_drive_sync_jobs.sql` y `supabase/migrations/20260909030000_course_resources.sql` en el proyecto Supabase, después de realizar un backup lógico.
2. Mantener en el PC el mismo `.env.local` de producción: Supabase, credenciales Google Drive y la raíz real de la biblioteca.
3. Arrancar la versión de producción local:

```powershell
cd web
npm run build
npm run start
```

4. Abrir `http://localhost:3000`, iniciar sesión como administrador y autorizar Drive si se solicita.

## Uso

En `/admin`, usar **Crear previsualización**. La aplicación procesa hasta cuatro carpetas por lote y guarda la cola, los archivos detectados y los conteos en Supabase.

- Si se cierra el navegador, se corta la red o se reinicia el PC, volver a `/admin` y elegir **Reanudar**.
- Un error temporal de Drive (`429` o `5xx`) se reintenta con espera progresiva y un pequeño desfase aleatorio.
- Un error de permisos o configuración deja el trabajo marcado con error; corregirlo y crear una nueva previsualización.
- Cuando el estado sea **Lista para publicar**, revisar los conteos y confirmar la publicación. Esa operación usa el snapshot ya almacenado: no vuelve a recorrer Drive.
- Los PDF, archivos comprimidos, documentos, proyectos y subtítulos reconocidos aparecen después en el reproductor como recursos descargables. Drive sigue siendo su única ubicación.

## Límites actuales

La credencial de actualización de Drive sigue en una cookie local. Por tanto, la reanudación requiere abrir la aplicación local con la misma cuenta administradora y volver a autorizar Drive si la cookie expiró. El traslado de esa credencial a almacenamiento cifrado de servidor corresponde al Hito 4.
