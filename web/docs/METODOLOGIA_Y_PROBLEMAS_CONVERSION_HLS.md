# Metodología y problemas de conversión HLS

**Última consolidación:** 17 de septiembre de 2026  
**Ámbito:** biblioteca privada de Películas y Series de Nébula.

> El nombre técnico correcto es **HLS** (*HTTP Live Streaming*), no “HSL”.
> Este documento conserva el aprendizaje de la primera migración masiva para
> que las futuras tandas no requieran repetir la investigación ni los pasos
> manuales que ya se eliminaron.

## 1. Objetivo que se resolvió

Los archivos de origen eran principalmente MKV, con combinaciones distintas de
vídeo, varios idiomas de audio y subtítulos. Un MKV no es un formato fiable para
reproducción directa en todos los navegadores. Además, generar un MP4 completo
por idioma habría duplicado el vídeo y el espacio utilizado.

La solución adoptada fue HLS VOD privado:

- un único flujo de vídeo por título;
- audios alternativos independientes (normalmente español e inglés);
- subtítulos WebVTT cuando la pista permite convertirlos;
- archivos segmentados que el reproductor pide conforme avanza el vídeo;
- Google Drive como almacenamiento privado de los paquetes;
- Supabase como catálogo e índice privado de las rutas e IDs de Drive.

Esto permite cambiar audio sin reiniciar ni descargar otro vídeo completo. Safari
usa HLS de forma nativa; Chrome, Edge y Firefox lo reproducen con `hls.js`.

## 2. Arquitectura final

```text
MKV original (se conserva)
        |
        v
Conversión y validación local
        |
        v
Paquete HLS bajo código interno
        |
        v
100_BIBLIOTECA_ENTRETENIMIENTO en Google Drive (privado)
        |
        v
Migrador local de solo lectura
        |
        v
Supabase: catálogo + paquete + ruta relativa -> ID de Drive
        |
        v
Nébula: verifica usuario/permisos y reproduce
```

Drive conserva los archivos; Supabase no guarda una copia del vídeo. El índice
es necesario porque Drive trabaja con IDs y no entiende que una línea como
`audio/es/index.m3u8` representa una ruta dentro de una carpeta.

## 3. Identidad y estructura obligatorias

El código interno identifica el paquete. Nunca se genera automáticamente a
partir del nombre del MKV:

- Película: `MOV-00001`.
- Episodio: `SER-00001-S01-E01`.
- Episodios 100 a 999: `SER-00003-S01-E100`.

Un código legible, por ejemplo `HPPF-00001`, es administrativo y opcional. No
reemplaza el código interno.

Antes de convertir se debe mantener un inventario privado
`archivo-origen -> código-interno`. Las rutas de los discos, auditorías de los
originales y credenciales no se suben a Git.

La estructura que debe llegar a Drive es:

```text
100_BIBLIOTECA_ENTRETENIMIENTO/
  MOV-00001/
    master.m3u8
    video/index.m3u8
    video/segment_00000.ts (o .m4s)
    audio/es/index.m3u8
    audio/es/segment_00000.ts (o .m4s)
    audio/en/index.m3u8              # solo si existe
    subtitles/es.vtt o subtitles/es/index.m3u8  # solo si existe

  SER-00003/
    SER-00003-S01-E01/
      master.m3u8
      video/
      audio/
    SER-00003-S01-E02/
      ...
```

Las películas quedan directamente bajo la raíz y los episodios se agrupan dentro
de una carpeta por serie. Esta agrupación evita que decenas de episodios queden
mezclados con las películas y hace más segura la migración automática.

## 4. Criterios de conversión establecidos

### Vídeo

- H.264 compatible: se empaqueta sin recodificar siempre que perfil y nivel
  sean razonables para los dispositivos destino.
- HEVC/H.265: se evalúa primero. Si no es fiable en HLS para el destino, se
  recodifica a H.264.
- Se elige una sola pista de vídeo útil y se ignoran portadas o adjuntos.

### Audio

- La salida estándar es AAC.
- Se conservan las pistas alternativas verificadas (por ejemplo ES y EN).
- Español se marca como predeterminado cuando existe.
- No se inventa un idioma: si el origen solo tiene una pista, el paquete solo
  muestra esa pista.

### Subtítulos

- SubRip y ASS se convierten a WebVTT cuando conservan bien el texto.
- Los estilos complejos de ASS no son prioridad: WebVTT privilegia legibilidad.
- PGS es imagen, no texto; inicialmente se deja para revisión o se excluye sin
  bloquear el vídeo y el audio.
- En algunos títulos piloto se observó un desfase aproximado de 1,5 s. Ese
  ajuste debe resolverse como corrección explícita de subtítulo, nunca
  modificando arbitrariamente la duración del vídeo.

## 5. Cómo se validó la configuración

No se convirtió la colección de golpe. Se ejecutó un piloto que cubría:

- un título con audio español/inglés;
- un título con ASS;
- un título con PGS;
- un episodio de serie;
- un título HEVC.

El piloto confirmó que la regla de “un vídeo + audio alternativo” era viable.
Después se usó la misma configuración para películas, Pokémon Generations,
Pokémon Origins, Dragon Ball Super y las películas restantes.

La validación por paquete es:

1. Existe `master.m3u8`.
2. Cada ruta que el master declara existe en el paquete.
3. Video y cada audio cubren la duración prevista.
4. El selector ES/EN cambia de pista sin reiniciar la reproducción.
5. Los subtítulos cargan solo si el archivo/lista realmente existe.
6. Se adelanta, se pausa y se llega al final de la obra.
7. Se prueba localmente y luego desde Drive a través de Nébula.

Un paquete solo pasa a `ready` después de estas comprobaciones.

## 6. Flujo que se debe repetir para contenido nuevo

1. Registrar en el inventario privado el original y su código interno.
2. Ejecutar `ffprobe` y revisar vídeo, idiomas, subtítulos y duración.
3. Convertir en una carpeta temporal separada de los originales, por ejemplo
   `_HLS_VALIDATED` en el mismo disco con espacio suficiente.
4. Validar localmente el paquete completo.
5. Subir **la carpeta completa**, sin renombrar archivos ni subcarpetas, a
   `100_BIBLIOTECA_ENTRETENIMIENTO`.
6. Importar o crear el título/episodio en el catálogo usando el inventario CSV.
7. Ejecutar desde `web` el migrador local:

   ```powershell
   npm run media:migrate
   ```

   Para un paquete sustituido o reparado:

   ```powershell
   npm run media:migrate -- --code MOV-00007 --rescan
   ```

8. Probar reproducción, audio y subtítulos desde Nébula.
9. Publicar únicamente cuando el paquete esté listo.
10. Conservar original y copia temporal hasta confirmar subida, migración y
    reproducción. Después la copia temporal puede borrarse si hace falta
    espacio; el original no se borra como parte del flujo.

No se debe pegar un ID de Drive para cada título. El migrador registra los IDs
automáticamente, y puede reanudarse: salta paquetes ya listos si su carpeta no
cambió. Véase [MEDIA_HLS_LOCAL_MIGRATOR.md](MEDIA_HLS_LOCAL_MIGRATOR.md).

## 7. Rendimiento de conversión: CPU frente a RTX 4060

La primera conversión larga ejecutada en CPU tardó del orden de tres horas. Al
usar la RTX 4060 con NVENC, una tanda comparable se completó aproximadamente en
una hora. La aceleración no cambia la estructura HLS ni obliga a bajar calidad:
la diferencia depende de los parámetros de codificación elegidos.

Para futuras tandas:

- usar NVENC para recodificaciones H.264 largas;
- copiar vídeo H.264 ya compatible, cuando sea posible;
- no apagar ni forzar suspensión durante una conversión;
- conservar un registro periódico de segmentos procesados, total, porcentaje y
  minutos aproximados;
- no asumir que una conversión interrumpida es válida solo porque existen
  archivos parciales.

Los apagados inesperados del equipo ocurrieron durante la campaña. Por esa
razón, los paquetes interrumpidos se inspeccionaron y se regeneraron cuando era
necesario; no se publicaron simplemente por estar presentes en el disco.

## 8. Incidencias reales y resolución

### 8.1 Error 404 en audio o subtítulos HLS

**Síntomas:**

```text
audioTrackLoadError · HTTP 404 · audio/es/index.m3u8
subtitleTrackLoadError · HTTP 404 · subtitles/es.vtt
```

**Causa:** el `master.m3u8` declaraba una pista cuya ruta no estaba registrada
en el índice de Supabase, no existía en Drive, o la lista referenciaba segmentos
ausentes.

**Resolución aplicada:**

- validar de forma recursiva las referencias de playlists;
- registrar correctamente cada ruta relativa con su ID de Drive;
- excluir pistas inexistentes en vez de anunciarlas en el master;
- reindexar el paquete corregido con `--rescan`.

La lección es que un reproductor puede mostrar duración 0:00 y aun así fallar
en cuanto intenta cargar una pista alternativa. La existencia de `master.m3u8`
no basta.

### 8.2 Sincronización masiva lenta desde la página

**Problema:** el primer intento de asociar toda la biblioteca desde el navegador
hacía miles de consultas a Drive y dependía de que el servidor y la pestaña
siguieran activos. Era lento, frágil y provocaba renovaciones OAuth molestas.

**Resolución:** se creó el migrador local `npm run media:migrate`.

- Usa una cuenta de servicio con permiso de **Lector** sobre la raíz HLS.
- Lista carpetas y archivos por lotes, no una petición por fragmento.
- Inserta los assets por lote en Supabase.
- Guarda respaldo y progreso local en `scripts/output/`.
- Es reanudable e idempotente; los paquetes sin cambios se saltan.

La biblioteca terminó con 184 paquetes HLS revisados e indexados. El navegador
ya no debe realizar ese escaneo masivo de Drive.

### 8.3 Renovación OAuth de Drive y producción

**Síntoma:** mensajes de “Debes autorizar Google Drive”, reconexiones repetidas,
o `invalid flow state`.

**Qué se corrigió:**

- separar el indexado (cuenta de servicio local) de la reproducción (cuenta
  real del lector);
- conservar la autorización renovable en cookie segura HttpOnly, no en
  Supabase ni en JavaScript;
- configurar la URL exacta de producción en Supabase, sin comodines en
  `Site URL`;
- agregar el dominio de producción como origen permitido en Google Cloud;
- conservar el callback de Supabase como redirect URI de Google.

En modo de pruebas de Google, cada familiar debe ser añadido como **Test user**.
No se debe publicar ampliamente una app que solicita `drive.readonly` sin pasar
por el proceso de verificación de Google.

### 8.4 Dragon Ball Super: episodios vacíos, ausentes o dañados

Durante la revisión se encontraron episodios con paquetes aparentes pero sin
contenido utilizable, numeraciones con huecos y un episodio que cerraba al
adelantar. También se verificó que algunos archivos locales sí abrían en VLC,
por lo que había que distinguir entre problema de paquete HLS, de fuente y de
numeración.

**Tratamiento seguido:**

- revisar el archivo fuente y el paquete por episodio, no marcar toda la serie
  como fallida;
- dejar explícitos los huecos verdaderos en el inventario, en vez de inventar
  episodios;
- regenerar los paquetes de episodios sustituidos;
- reemplazar el material defectuoso del tramo final por fuentes completas;
- verificar pista de audio correcta en episodios con más de una pista;
- subir y reindexar de nuevo los episodios reparados.

La regla resultante: si un episodio abre pero falla al buscar una posición
avanzada, se considera no validado y se sustituye o reconvierte.

### 8.5 Pokémon Origins: pista de doblaje incorrecta o ausente

La conversión inicial no conservó el doblaje esperado en todos los episodios.
Se comprobó qué pista era español latino y se regeneraron los episodios que
requerían reemplazo, incluidos los episodios 3 y 4.

**Lección:** las etiquetas de idioma del contenedor no sustituyen una escucha
rápida de control. “Español” puede ser latino, España o una pista con etiqueta
incorrecta.

### 8.6 Problemas de disco y de copia: MOV-00007

Un paquete, `MOV-00007`, quedó atascado al copiarse y llegó a bloquear el
Explorador de Windows / sincronización de Drive. Como el contenido restante del
disco se pudo copiar, no se asumió que toda la biblioteca estuviera perdida.

**Resolución:** se preservó una copia de los demás paquetes, se localizó el
original de MOV-00007 en otro disco, se convirtió nuevamente en una carpeta
temporal limpia y se subió/reindexó como paquete nuevo.

**Regla preventiva:** si mover una carpeta HLS se queda permanentemente en
0 bytes/s o bloquea el Explorador, no insistir sobre el mismo paquete. Copiar
el resto, comprobar el origen y regenerar el paquete afectado.

### 8.7 Drive Desktop y miles de fragmentos

Un paquete HLS puede contener miles de segmentos pequeños. Drive Desktop o el
Explorador de Windows pueden parecer congelados al sincronizar o moverlos, aun
cuando la operación siga avanzando muy despacio.

**Práctica aprobada:** subir una carpeta validada completa, esperar a que Drive
termine de sincronizar y comprobar desde Drive web al azar `master.m3u8`, una
lista de vídeo, una lista de audio y varios segmentos. Evitar mover paquetes
HLS entre unidades mientras Drive Desktop está sincronizándolos.

### 8.8 Metadatos TMDB equivocados

Las búsquedas por nombre pueden devolver obras distintas; por ejemplo, “La
Propuesta” llegó a asociarse con una película western ajena.

**Resolución:**

- preferir búsquedas específicas y confirmar año/tipo antes de vincular;
- permitir pegar una URL de TMDB o usar búsqueda manual;
- priorizar `es-MX` para metadatos en español latino cuando TMDB los tenga;
- almacenar el resultado confirmado en Supabase para no consultar TMDB en cada
  lectura del catálogo.

El idioma `es-MX` mejora la preferencia de la API, pero TMDB no garantiza
traducción latinoamericana para todas las obras.

### 8.9 Publicar no es lo mismo que indexar

Un paquete puede estar correctamente en Drive e indexado en Supabase y aun así
no aparecer en el catálogo lector: el título, serie padre, temporada o episodio
puede seguir en borrador.

**Orden correcto:** inventario -> paquete `ready` -> prueba -> publicar título
y, para series, publicar también serie/temporada/episodio según corresponda.

## 9. Decisiones que no se deben revertir sin una razón nueva

- No subir MKV como formato de reproducción web principal.
- No crear un MP4 completo por cada idioma solo para tener audio alternativo.
- No mezclar paquetes HLS con los MKV originales.
- No publicar enlaces públicos permanentes de Drive.
- No guardar secretos, refresh tokens ni claves de cuenta de servicio en Git,
  Supabase o variables `NEXT_PUBLIC_*`.
- No volver a usar la página web para el primer escaneo completo de miles de
  assets; el migrador local es el mecanismo normal.
- No asumir que todos los episodios consecutivos existen ni que el número del
  archivo coincide con su contenido.

## 10. Qué queda por mejorar, sin invalidar la solución

La solución HLS ya funciona para la biblioteca privada. Las mejoras futuras no
requieren reconvertir todo:

1. Reducir la latencia inicial de Cursos: su archivo se entrega directo desde
   Drive, pero el arranque todavía realiza verificaciones de permisos y consumo
   por rangos. Se puede optimizar el arranque y agrupar esas verificaciones sin
   perder control de cuota.
2. Aplicar una corrección explícita a los subtítulos con desfase conocido.
3. Añadir Google Cast con un receptor propio y tokens temporales.
4. Crear PWA/offline: no descarga un MKV normal, sino contenido protegido para
   verlo dentro de la aplicación cuando no haya conexión.
5. Añadir una interfaz administrativa de permisos para familiares, en vez de
   ejecutar SQL manual para cada nuevo lector.

## 11. Referencias del proyecto

- [MEDIA_HLS_PREPARATION.md](MEDIA_HLS_PREPARATION.md): especificación de
  preparación y compatibilidad de medios.
- [MEDIA_HLS_LOCAL_MIGRATOR.md](MEDIA_HLS_LOCAL_MIGRATOR.md): uso seguro del
  migrador local Drive -> Supabase.
- [OPERACION_Y_DESPLIEGUE.md](OPERACION_Y_DESPLIEGUE.md): operación cotidiana,
  publicación y despliegue de Nébula.
