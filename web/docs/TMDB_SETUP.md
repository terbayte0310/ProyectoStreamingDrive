# Configuración de TMDB

La integración de metadatos usa la API de TMDB solo desde el servidor. Crea un
**API Read Access Token** en la configuración de tu cuenta de TMDB y añádelo a
web/.env.local:

    TMDB_API_READ_ACCESS_TOKEN=pega_aqui_tu_token_privado

No uses el prefijo NEXT_PUBLIC_, no subas este token a Git y reinicia npm run
dev después de cambiarlo.

Las operaciones administrativas viven en POST /api/admin/tmdb. Permiten buscar
películas o series, vincular el resultado elegido, actualizar la caché o
desvincularlo. La aplicación guarda en Supabase campos normalizados y la
respuesta completa de TMDB; las pantallas futuras deben leer esa caché, no
consultar la API en cada visita.

La clave se envía como token Bearer a la API v3, que TMDB documenta como su
método de autenticación recomendado. [Documentación de autenticación de
TMDB](https://developer.themoviedb.org/docs/authentication-application).
