# AUDITORÍA CLAUDE — Rendimiento de Nébula con internet lento (siempre gratis)

**Fecha:** 17 de septiembre de 2026
**Alcance:** `web/` (Next.js 16 + Supabase + Google Drive), `scripts/` de conversión HLS.
**Regla del documento:** todo lo propuesto es gratuito. Nada requiere pagar un plan, una CDN de vídeo ni almacenamiento adicional.

> Recordatorio de contexto: **Películas y Series** se sirven como paquetes **HLS** (el nombre correcto es HLS, *HTTP Live Streaming*) guardados en Drive. **Cursos** se sirven como el **archivo de vídeo completo** (MP4) leído por rangos desde Drive.

---

## 0. Resumen ejecutivo

Con 900 Mb/s la página “no carga muy rápido” porque **el problema no es el ancho de banda: es la latencia y la arquitectura**. Cada fragmento de vídeo hacía un recorrido largo (navegador → función de Vercel → Supabase varias veces → Google Drive → Vercel → navegador) y nada se guardaba en caché. En una conexión lenta ese mismo diseño se vuelve inutilizable, y además **el vídeo se codificó a una sola calidad muy alta (objetivo 12 Mb/s, picos de 20 Mb/s)**, así que con 5 Mb/s es físicamente imposible reproducir sin cortes.

| # | Causa raíz | Impacto | Estado |
|---|---|---|---|
| 1 | Cada segmento HLS pasaba por una función de Vercel | Latencia alta por segmento, consume la cuota gratuita de transferencia de Vercel | **Corregido** (entrega directa navegador → Google) |
| 2 | 3–4 consultas a Supabase por segmento, y el manifiesto cargaba **todas** las filas del paquete | Arranque lento, más lento cuanto más larga la película | **Corregido** |
| 3 | `cache-control: no-store` en listas y segmentos | Retroceder = volver a descargar | **Corregido** (segmentos inmutables) |
| 4 | El service worker se reinstalaba al cambiar de página (dos revisiones distintas) | Hasta 5 s de espera antes de reproducir | **Corregido** |
| 5 | Reserva de transferencia secuencial antes de cada lectura, con `getUser()` remoto | +1 viaje completo al servidor antes del primer byte | **Corregido** |
| 6 | El aula de cursos encadenaba 4 viajes desde el navegador | Pantalla de carga larga en cada lección | **Corregido** (carga en servidor + cambio de lección instantáneo) |
| 7 | **Una sola calidad de vídeo a ~12 Mb/s** | Imposible en conexiones < 12 Mb/s; sin calidad adaptativa | **Pendiente — la mejora más importante que queda** |
| 8 | MP4 de cursos sin `faststart` o con el vídeo troceado en muchos bloques `mdat` | El navegador hace decenas de peticiones a Drive antes de empezar (25-88 s) | **Corregido en 6 cursos** (remux sin pérdida, ver `docs/planificacion/08-preparacion-de-biblioteca-para-drive.md`). Los cursos con solo `moov` al final cuestan ~2-3 s y no se han tocado |
| 9 | Región de funciones de Vercel no alineada con Supabase/usuarios | Cada consulta suma decenas o cientos de ms | **Verificado y fijado**: Supabase en `us-east-1`, funciones en `iad1`; `web/vercel.json` lo deja explícito |
| 10 | Imágenes de TMDB pasando por la optimización de Vercel | Consume cuota gratuita y añade un salto | **Corregido** (CDN de TMDB con `srcset`) |

Si solo haces una cosa después de este rediseño: **ejecuta la Fase B (escalera de calidades HLS)**. La escalera completa (1080p + 720p + 480p + 360p) **pesa menos que la calidad única actual**, así que ni siquiera necesitas más espacio en Drive.

---

## 1. Cómo viaja hoy un vídeo

### 1.1 Películas y Series (HLS)

**Antes del rediseño**

```text
Navegador ──► Vercel (función)                       ← por CADA segmento de 6 s
                ├─► Supabase Auth (getClaims + perfil)
                ├─► Supabase (buscar el segmento, RLS con JOIN)
                ├─► Google (renovar token si hacía falta)
                └─► Google Drive (descargar el segmento)
             ◄── Vercel reenvía los bytes              ← el vídeo pasa DOS veces por Internet
```

**Después del rediseño (modo directo, por defecto)**

```text
Navegador ──► Vercel: solo manifiesto y listas (.m3u8, unos pocos KB, en caché 5 min)
Navegador ──► Service worker ──► Google Drive          ← segmentos directos, sin Vercel
                   └─► /api/transfer-budget en paralelo (el fusible sigue contando)
```

Si el modo directo falla (navegador sin service worker, Safari antiguo con HLS nativo, dos errores seguidos de fragmento), el reproductor **vuelve solo al proxy del servidor** sin perder la posición. Para desactivar el modo directo por completo, ver la sección 6.

### 1.2 Cursos (MP4 completo)

```text
Navegador ──► Service worker ──► Google Drive (Range: bytes=…)
                   └─► /api/transfer-budget (reserva)
```

Antes, la reserva salía **siempre antes** de la lectura y hacía `getUser()` (viaje a Supabase Auth), perfil, módulo, archivo y reserva: 5–6 consultas. Ahora usa `getClaims()` (validación local del JWT) y deja que las políticas RLS decidan; además, tras una reserva aprobada, las siguientes se hacen **en paralelo** a la descarga durante 90 s. El fusible sigue funcionando: la primera lectura de una sesión (y cualquiera después de un rechazo) sigue siendo secuencial.

---

## 2. Diagnóstico detallado (con evidencia del código)

### 2.1 Segmentos por Vercel — `api/media-hls/packages/[packageId]/[...path]/route.ts`
Cada segmento de 6 s era una invocación de función. Consecuencias:
- **Latencia**: arranque en frío + distancia a la región de la función (por defecto `iad1`, Washington) + ida a Drive + vuelta.
- **Coste gratuito**: todo el vídeo cuenta como transferencia de Vercel. Una película de 2 h a 12 Mb/s son ~10 GB; el plan gratuito (Hobby) tiene un tope mensual de transferencia que se agota con pocas películas. *Confirma los valores vigentes en el panel de Vercel → Usage.*

**Hecho:** nueva función `rewriteHlsPlaylistForDirect` (`web/src/lib/media/hls.ts`) que reescribe los segmentos a `/drive-hls/{idDeDrive}` y el service worker (`web/public/sw.js`) los descarga directamente de Google con el token del usuario. Las listas siguen pasando por el servidor (aplican permisos y pesan KB).

### 2.2 Consultas por petición
- El manifiesto leía **todas** las filas activas del paquete (miles en una película) y la RLS de `media_hls_assets` evalúa un `EXISTS` con `JOIN` por fila.
- Cada segmento hacía `getCurrentAccess()` (claims + perfil) aunque la RLS ya exige cuenta autorizada y módulo.

**Hecho:** el manifiesto lee solo su propia fila; las listas en modo proxy no consultan el paquete (reescriben todas las referencias locales); en modo directo consultan solo la carpeta de esa lista, paginada de 1000 en 1000 (PostgREST corta en 1000 filas). La identidad es `getSessionUserId()` (JWT local, sin viaje de red).

### 2.3 Caché
Todo respondía `private, no-store`. **Hecho:** listas `private, max-age=300`; segmentos `private, max-age=86400, immutable` (siempre privados: nunca se guardan en una CDN compartida).

### 2.4 Service worker reinstalado
La cabecera registraba `sw.js?revision=budget-v1` y el reproductor `sw.js?revision=media-hls-v1`. Cada vez que el usuario pasaba del catálogo al reproductor, el navegador instalaba otra versión y el reproductor esperaba hasta 5 s. **Hecho:** una sola revisión en `web/src/lib/media/drive-worker.ts` (`nebula-v3`), usada por todo el sitio y por las páginas de diagnóstico.

### 2.5 Arranque del aula de cursos
Antes: `getUser()` + acceso + lección → estructura + token + worker → archivo de Drive → progreso (al cargar metadatos). Cuatro viajes encadenados desde el navegador. **Hecho:** `web/src/app/course-player/page.tsx` resuelve todo en el servidor en dos rondas paralelas; el navegador solo prepara el worker y el token (en paralelo). Cambiar de lección ya no recarga la página (se usa `history.pushState`), así que es instantáneo.

### 2.6 Calidad única y bitrate muy alto (pendiente)
En `scripts/convert_hls_package.ps1`:
- NVENC: `-cq 19 -b:v 12M -maxrate 20M -bufsize 24M -level:v 5.1`
- CPU: `-crf 20 -level:v 5.1`
- Una sola variante de vídeo, segmentos de 6 s.

Con una sola variante, hls.js **no puede bajar de calidad**: si la conexión no sostiene ~12–20 Mb/s, habrá cortes siempre. Esta es la causa principal de la mala experiencia con internet lento.

### 2.7 Cursos en MP4 (pendiente)
Los cursos se reproducen por rangos del archivo original. Dos problemas típicos de archivos descargados de plataformas:
- Átomo `moov` al final (sin *faststart*): el navegador tiene que pedir el final del archivo antes de poder empezar.
- Bitrates altos (1080p a 4–8 Mb/s) sin alternativa ligera.

### 2.8 Región y distancia (pendiente)
Cada consulta de servidor (catálogo, fichas, reservas) paga la distancia **función ↔ Supabase**. Si Supabase está, por ejemplo, en `us-east-1` y la función en `iad1`, perfecto; si Supabase está en São Paulo y la función en Washington, cada consulta suma ~120 ms.

### 2.9 Imágenes
Los pósters de TMDB pasaban por `next/image` (cuota gratuita de optimización de Vercel). **Hecho:** se sirven desde la CDN de TMDB con `srcset` (`w185/w342/w500`, fondos `w780/w1280`) y carga diferida.

### 2.10 Peticiones CORS a Google en modo directo
El worker envía `Authorization: Bearer …`, así que el navegador hace una verificación previa (preflight `OPTIONS`) por URL distinta. Contra la red de Google suele costar 20–60 ms, muy por debajo del salto por Vercel que se eliminó. Si algún día molesta, la alternativa gratuita es la Fase F (proxy en el borde).

---

## 3. Plan de acción gratuito

### Fase A — ya aplicada en este rediseño
- Entrega directa de segmentos HLS por service worker, con respaldo automático al proxy.
- Menos consultas por petición y caché correcta en listas y segmentos.
- Service worker con revisión única.
- Reserva de transferencia en paralelo cuando está “caliente”.
- Aula de cursos cargada en servidor y cambio de lección instantáneo.
- hls.js configurado para redes lentas (`web/src/components/media-hls-player.tsx`):
  `abrEwmaDefaultEstimate: 1.5 Mb/s`, `capLevelToPlayerSize`, `startFragPrefetch`, `maxBufferLength: 30`, reintentos de fragmento con espera progresiva y recuperación automática de errores de red y de medio.
- Progreso local de películas y series (reanudar sin consultas).
- Imágenes de TMDB desde su CDN.

### Fase B — Escalera de calidades HLS (la más importante)

**Objetivo:** que cada título tenga 3–4 calidades para que hls.js elija sola según la conexión. El reproductor ya muestra el selector “Calidad” y la etiqueta “Auto (720p)” en cuanto el paquete tenga varias variantes; no hay que tocar la web.

**Escalera recomendada (H.264 High, GOP de 2 s alineado, segmentos de 4 s):**

| Variante | Resolución | Vídeo (media / máx.) | Para conexiones de |
|---|---|---|---|
| 1080p | 1920×1080 | 5,0 / 7,5 Mb/s | ≥ 10 Mb/s |
| 720p | 1280×720 | 2,8 / 4,2 Mb/s | 5–10 Mb/s |
| 480p | 854×480 | 1,2 / 1,8 Mb/s | 2,5–5 Mb/s |
| 360p | 640×360 | 0,7 / 1,05 Mb/s | 1–2,5 Mb/s |
| Audio | AAC estéreo | 128 kb/s por idioma | — |

**Espacio:** la suma de la escalera es ~9,7 Mb/s de vídeo. La calidad única actual apunta a 12 Mb/s (con picos de 20). Es decir: **la escalera completa ocupa menos que lo que ya tienes**. Una película de 2 h pasa de ~10,8 GB a ~8,7 GB.

**Comando de referencia (CPU, gratuito, sin NVENC)** — ejecútalo sobre el MKV de origen dentro de la carpeta de salida del paquete. Mantiene la estructura actual (`master.m3u8`, `video/…`, `audio/<idioma>/…`) para que el migrador y el escáner sigan funcionando:

```powershell
# Vídeo: 4 variantes en una sola pasada (decodifica una vez, escala 4 veces)
ffmpeg -hide_banner -y -i "$Origen" `
  -filter_complex "[0:v:0]split=4[v1][v2][v3][v4];[v1]scale=-2:1080[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:480[v3o];[v4]scale=-2:360[v4o]" `
  -map "[v1o]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 7500k -bufsize:v:0 10000k `
  -map "[v2o]" -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 4200k -bufsize:v:1 5600k `
  -map "[v3o]" -c:v:2 libx264 -b:v:2 1200k -maxrate:v:2 1800k -bufsize:v:2 2400k `
  -map "[v4o]" -c:v:3 libx264 -b:v:3 700k  -maxrate:v:3 1050k -bufsize:v:3 1400k `
  -preset slow -profile:v high -level:v 4.1 -pix_fmt yuv420p `
  -g 48 -keyint_min 48 -sc_threshold 0 `
  -f hls -hls_time 4 -hls_playlist_type vod -hls_flags independent_segments `
  -hls_segment_type mpegts `
  -var_stream_map "v:0,name:1080 v:1,name:720 v:2,name:480 v:3,name:360" `
  -master_pl_name master-video.m3u8 `
  -hls_segment_filename "video/%v/segment_%05d.ts" "video/%v/index.m3u8"
```

Notas:
- `-g 48` supone 24 fps (2 s). Para 30 fps usa `-g 60 -keyint_min 60`. Todas las variantes deben tener los **mismos cortes** para que hls.js cambie de calidad sin saltos.
- `-level:v 4.1` en lugar de 5.1 mejora la compatibilidad con móviles y teles.
- El audio se sigue generando como hoy (una lista por idioma). Después se compone el `master.m3u8` final con un `#EXT-X-STREAM-INF` por variante, cada una con `AUDIO="aud"`, y los `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",…` que ya produce el script. Ejemplo de `master.m3u8`:

```text
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",DEFAULT=YES,AUTOSELECT=YES,URI="audio/es/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="audio/en/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles/es/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=7700000,AVERAGE-BANDWIDTH=5200000,RESOLUTION=1920x1080,CODECS="avc1.640029,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
video/1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4400000,AVERAGE-BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
video/720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=1350000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
video/480/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,AVERAGE-BANDWIDTH=850000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
video/360/index.m3u8
```

- **Orden de trabajo sugerido:** primero los títulos más vistos. Los paquetes antiguos siguen funcionando mientras tanto (una sola variante).
- **Con NVENC (más rápido, también gratis):** sustituye `libx264 … -preset slow` por `h264_nvenc -preset p5 -rc vbr` y el filtro `scale` por `scale_cuda` como ya hace el script. Mantén los mismos bitrates.
- **Re-escaneo:** después de subir la nueva carpeta a Drive, usa *Administrar → Películas y Series → Fuentes de Drive → Sincronizar paquetes pendientes* (o el migrador `npm run media:migrate`).
- **Validación:** `ffprobe -v error -show_entries stream=codec_name,width,height,bit_rate -of compact video/720/index.m3u8` y reproducir limitando la red en Chrome (sección 4).

### Fase C — Cursos más ligeros (gratis y sin pérdida)

1. **Faststart (sin recodificar, sin pérdida de calidad):** mueve el índice `moov` al inicio para que la lección empiece sin descargar el final.

```powershell
# Detectar si un MP4 ya tiene faststart (moov antes de mdat)
ffprobe -v trace -i "leccion.mp4" 2>&1 | Select-String -Pattern "type:'(moov|mdat)'" | Select-Object -First 2

# Arreglarlo (copia directa de pistas, segundos por archivo)
ffmpeg -hide_banner -y -i "leccion.mp4" -c copy -map 0 -movflags +faststart "leccion.faststart.mp4"
```

   Hazlo en local y reemplaza el archivo en Drive **conservando el mismo archivo** (Drive → clic derecho → *Gestionar versiones → Subir nueva versión*): así el ID no cambia y no hay que re-sincronizar el catálogo.

2. **Bitrate razonable para lecciones:** las lecciones son pantallas, diapositivas y una cara. 720p a CRF 26–28 queda por debajo de 1,5 Mb/s sin pérdida perceptible:

```powershell
ffmpeg -hide_banner -y -i "leccion.mp4" -c:v libx264 -preset slow -crf 27 -vf "scale=-2:'min(720,ih)'" -c:a aac -b:a 96k -ac 2 -movflags +faststart "leccion.720.mp4"
```

   Úsalo solo en los cursos con archivos muy pesados (el panel *Administrar cursos → Diagnóstico → Analizar tamaños* te dice cuáles).

3. **A medio plazo:** convertir los cursos al mismo pipeline HLS con escalera. Así también tendrían calidad adaptativa. Requiere añadir paquetes HLS a lecciones en el esquema (hoy solo existen para películas y episodios); el reproductor nuevo ya lo soporta.

### Fase D — Región, caché del router y prefetch (configuración, gratis)

1. **Alinear región de funciones con Supabase.** Mira la región de tu proyecto en Supabase (*Project Settings → General → Region*). Crea `web/vercel.json`:

```json
{
  "regions": ["iad1"]
}
```

   Cambia `iad1` por la región de Vercel más cercana a Supabase (`gru1` São Paulo, `cle1`/`iad1` EE. UU. este, `fra1` Fráncfort…). El plan gratuito permite una región para funciones.

2. **Caché del router del cliente** para que volver al catálogo sea instantáneo. En `web/next.config.ts`, revisa la opción `staleTimes` en `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md` (en esta versión de Next puede requerir `experimental`), por ejemplo `dynamic: 30` segundos.

3. **Mantener `loading.tsx`** en cada segmento con datos (ya existen para catálogo, aula y reproductor): el HTML del esqueleto sale en milisegundos aunque la consulta tarde.

### Fase E — Medir sin pagar

- **En el navegador:** DevTools → *Network* → perfil *Slow 4G* / *Fast 4G* y *Disable cache*. En *Application → Service workers* confirma `sw.js?revision=nebula-v3`.
- **En el reproductor:** abre la consola; `document.querySelector('video')` + `buffered`, y en películas el estimador de hls.js se ve con un punto de ruptura en `media-hls-player.tsx` (`instance.bandwidthEstimate`).
- **En el servidor:** los logs `[startup-performance]` (catálogo) siguen activos en Vercel → *Logs*.
- **Vercel Speed Insights / Web Analytics** tienen capa gratuita limitada; suficiente para 6 usuarios.

**Objetivos razonables tras la Fase B:**

| Conexión | Primer fotograma | Cortes |
|---|---|---|
| 50+ Mb/s | < 1,5 s | 0 |
| 10 Mb/s | < 2,5 s | 0 (1080p/720p) |
| 3 Mb/s | < 4 s | 0 (480p) |
| 1,5 Mb/s | < 6 s | 0 (360p) |

### Fase F — Opcional: proxy en el borde (Cloudflare, capa gratuita)

Solo si algún navegador de la familia no admite service workers o las verificaciones CORS pesan: un Cloudflare Worker gratuito puede firmar las lecturas a Drive desde el borde más cercano al usuario. Antes de hacerlo revisa los términos vigentes de Cloudflare sobre vídeo y los límites diarios de la capa gratuita. No es necesario con la Fase A + B.

---

## 4. Cómo probarlo paso a paso

1. `cd web && npm run build && npm run start` (o despliega a una *preview* de Vercel).
2. Chrome → DevTools → *Network* → *Fast 4G* → abre una película:
   - En la pestaña *Network* deben aparecer peticiones a `/drive-hls/…` servidas **(from ServiceWorker)** y a `googleapis.com`; **no** a `/api/drive-token/media-playback/packages/…/segment_…`.
   - Las `.m3u8` deben venir de `/api/drive-token/media-playback/packages/…?delivery=direct`.
3. Cambia a *Slow 4G*: con un paquete de una sola calidad verás esperas (esperado); con la escalera de la Fase B verás el cambio a 480p/360p y la etiqueta “Auto (480p)” en el reproductor.
4. Retrocede 30 s: los segmentos deben salir de caché (*disk cache* / *from ServiceWorker*).
5. Cursos: abre una lección, pasa a la siguiente con el botón “Siguiente”: no debe recargarse la página ni aparecer el esqueleto.

---

## 5. Límites gratuitos a vigilar

*Valores orientativos a septiembre de 2026; confirma siempre en cada panel.*

| Servicio | Qué consume Nébula | Cómo lo reduce este rediseño |
|---|---|---|
| **Vercel Hobby** | Invocaciones de funciones, CPU activa, transferencia | Los segmentos ya no pasan por funciones; `/signin` es estática; menos consultas por página |
| **Supabase Free** | Consultas, egress, conexiones | Viewer memorizado por petición, sin `getUser()` remoto en rutas calientes, manifiesto de 1 fila |
| **Google Drive API** | Una lectura por segmento/rango, cuotas por usuario y por proyecto | Caché inmutable de segmentos; segmentos de 4 s en la Fase B equilibran tamaño y número de lecturas |
| **Drive (almacenamiento)** | Paquetes HLS | La escalera de la Fase B ocupa menos que la calidad única actual |
| **TMDB** | Solo el panel de administración | Los lectores nunca llaman a TMDB (todo está cacheado en Supabase) |

Riesgo específico de Drive: si un mismo archivo recibe muchísimas descargas en poco tiempo, Google puede responder *download quota exceeded* durante unas horas. Con 6 usuarios es improbable; el service worker ya reintenta con espera y el fusible de transferencia (`/api/transfer-budget`) limita el total diario.

---

## 6. Reversión y seguridad

- **Volver al proxy del servidor para todo:** en `web/src/components/media-hls-player.tsx`, cambia `const direct = …` por `const direct = false;`. El resto sigue funcionando igual que antes del rediseño.
- **Service worker:** si necesitas forzar una actualización en todos los dispositivos, cambia `DRIVE_WORKER_REVISION` en `web/src/lib/media/drive-worker.ts`.
- **Permisos:** la entrega directa no amplía accesos. Las listas siguen protegidas por RLS (módulo + publicado), el token de Drive nunca llega a la página (vive dentro del service worker) y los segmentos se cachean como `private`.
- **Credenciales:** el JSON de la cuenta de servicio (`web/biblioteca-de-cursos-*.json`) está ignorado por Git; mantenlo así y no lo subas a Drive ni a Vercel como archivo (usa variables de entorno).
