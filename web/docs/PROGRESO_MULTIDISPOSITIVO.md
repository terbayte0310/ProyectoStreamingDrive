# Progreso de películas y series

`media_progress` guarda una fila por cuenta y paquete HLS. La clave primaria
sirve de índice para las lecturas individuales y por lote. Las políticas RLS
permiten acceder únicamente al progreso propio de paquetes accesibles.

El reproductor consulta una vez al preparar el vídeo, en paralelo con el token,
worker y hls.js. Espera como máximo dos segundos por esa consulta; si falla,
reanuda desde la caché local de la cuenta. No modifica la posición con una
respuesta que llegue después de ese límite.

La caché se actualiza cada cinco segundos. La nube recibe un checkpoint cada
treinta segundos si cambió la posición, y al pausar, terminar, ocultar la pestaña,
salir o desmontar el reproductor. Se evita repetir la misma posición y solo hay
una escritura en vuelo, con espacio para el último checkpoint de salida. Las
peticiones usan `keepalive`; el navegador no garantiza su entrega al cerrar.
Los fallos conservan la caché y se reintentan en el siguiente intervalo, al volver
la conexión o al abrir de nuevo el contenido.

La lista de episodios y el botón Continuar comparten las lecturas en vuelo,
agrupadas en hasta 200 paquetes por petición. No hay peticiones por tarjeta ni
suscripciones Realtime. Los cursos mantienen `lesson_progress`.

Se usa el checkpoint con la fecha más reciente, no el mayor segundo reproducido,
para permitir retroceder o volver a ver contenido. La función SQL también evita
que una petición antigua sobrescriba un checkpoint más reciente. Las fechas
provienen del dispositivo, limitadas a la hora del servidor al guardar; diferencias
grandes entre relojes pueden afectar la elección del checkpoint.

Los checkpoints antiguos sin cuenta se adoptan una sola vez por la primera
cuenta que consulte ese contenido en el dispositivo y se retira la clave antigua.

La migración necesaria es `20260929010000_media_progress.sql`. Antes de desplegar
la aplicación, ejecutar desde `web`:

```powershell
supabase db push --dry-run
supabase db push
```

Validación manual: abrir el mismo contenido en dos navegadores con la misma
cuenta; reproducir, pausar y volver a abrir en el otro navegador. Comprobar que
retoma tres segundos antes del checkpoint y que otra cuenta no hereda el avance.
Con la red desconectada, el guardado local debe seguir funcionando y sincronizar
al recuperar la conexión. Un título terminado comienza desde cero al volver a verlo.
