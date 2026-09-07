# Estado y backlog — Biblioteca personal de cursos

**Última actualización:** 7 de septiembre de 2026  
**Estado:** MVP funcional para el curso piloto de AWS.  
**Repositorio:** Git local en `ProyectoStreamingDrive`; todavía no hay remoto configurado.

## Propósito del proyecto

Aplicación personal para organizar y reproducir cursos almacenados en Google Drive. Puede compartir el catálogo con amigos autorizados, pero cada persona mantiene su propio progreso y sus propias notas.

La misma arquitectura puede servir videos personales, como películas o series, siempre que se respeten los permisos y los formatos compatibles del navegador.

## Alcance acordado

Incluido en el MVP:

- Inicio de sesión con Google y lista de usuarios autorizados.
- Catálogo importado desde una biblioteca concreta de Google Drive.
- Reproducción HTML5 con progreso, reanudación, siguiente lección y notas por tiempo.
- Descarga de una lección al dispositivo actual.
- Administración futura de títulos, orden, metadatos y portadas.

Fuera del alcance inicial:

- Modo offline integrado en la aplicación. Descargar un archivo al dispositivo **sí** existe; administrarlo como biblioteca offline dentro de la aplicación, no.
- Pagos, suscripciones, catálogo público o edición de Drive.
- Recomendaciones automáticas y funciones sociales.

## Decisiones técnicas que no se deben perder

| Decisión | Motivo |
| --- | --- |
| Google Drive guarda los archivos; Supabase guarda el catálogo editable y el estado privado. | Evita duplicar cientos de GB de video y separa archivos de información de aprendizaje. |
| Reproductor HTML5 nativo, no iframe `/preview` de Drive. | El iframe no expone tiempo actual, duración ni evento de finalización para construir progreso o notas. |
| Service Worker para `/drive-stream/<id>`. | Añade temporalmente el token de Drive a las peticiones del `<video>` y conserva las peticiones `Range` necesarias para adelantar. |
| `drive.readonly` para la sesión de Drive. | `drive.metadata.readonly` permite leer el catálogo pero no el contenido de los videos. |
| `lesson_progress` es la fuente única de verdad del progreso. | El catálogo calcula sus porcentajes a partir de esa tabla; no se mantiene un porcentaje duplicado en `courses`. |
| Descarga mediante `webContentLink`, no reutilizando la respuesta de streaming. | Chrome rechazó la primera estrategia de convertir el stream en descarga dentro del Service Worker. |

## Estado validado manualmente

El curso piloto `Curso AWS Lambda y API Gateway` se importó correctamente:

- 42 archivos encontrados.
- 8 carpetas encontradas.
- 37 lecciones reproducibles y 6 secciones.
- 1 archivo ignorado (`desktop.ini`).

Se validó tanto con la cuenta propietaria como con una cuenta lectora autorizada:

- Inicio de reproducción HTML5.
- `loadedmetadata`, duración real y peticiones `206 Partial Content`.
- Adelantar dentro de videos largos y evento `ended`.
- Progreso, reanudación y porcentaje del curso.
- Notas ancladas a un segundo del video y salto al pulsarlas.
- Descarga real al dispositivo desde Drive.

## Arquitectura actual

```text
Google Drive
  └── archivos y carpetas de cursos
        ↓ importación de metadatos
Supabase
  ├── catálogo: categorías, cursos, secciones y lecciones
  └── datos privados: progreso, notas y preferencias
        ↓
Next.js
  ├── catálogo y reproductor
  └── autenticación de usuario
        ↓ token temporal en memoria
Service Worker
  └── /drive-stream/<id> → Drive con Authorization + Range
```

El Service Worker no guarda el token en la base de datos ni en `localStorage`. Solo lo conserva en memoria durante su vida útil.

## Advertencias técnicas conocidas

### Service Worker y recarga dura

`Ctrl + Shift + R` le pide a Chrome saltarse el Service Worker. Por diseño, entonces `/drive-stream/<id>` no puede añadir el encabezado de autorización y el video queda en `0:00`.

Para uso normal basta `Ctrl + R`. El reproductor registra y espera la revisión esperada del Worker antes de entregarle el token.

### Token de Drive

La sesión actual usa un token temporal. Debe implementarse una renovación controlada antes de considerar la aplicación lista para sesiones largas o muchos amigos.

### Formatos

La ruta segura para navegador es MP4 con video H.264 y audio AAC. MKV, AVI, códecs poco comunes o MP4 sin `faststart` pueden fallar o hacer lentos los saltos de tiempo.

### OAuth de producción

`drive.readonly` es un scope restringido. En modo de pruebas funciona con los usuarios de prueba añadidos; antes de abrir la aplicación a más personas hay que revisar el proceso de publicación y verificación de Google.

## Historial de commits relevantes

| Commit | Significado |
| --- | --- |
| `b20c0d6` | Base de biblioteca de cursos con Drive. |
| `3c25556` | Notas por lección ancladas al segundo actual. |
| `a96a13b` | Porcentaje de curso y reanudación desde el catálogo. |
| `8834546` | Descarga directa desde Google Drive; documenta la corrección de descarga y actualización del Worker. |

### Convención para futuros commits

Usar `tipo(área): resultado` y un cuerpo explicativo. Ejemplos:

- `feat(admin): permite editar títulos y portadas`
- `fix(drive): renueva el token antes de fallar la reproducción`
- `docs(handoff): actualiza el backlog del MVP`

Cuando exista un error relevante, incluir explícitamente: **síntoma**, **causa** y **solución**.

## Backlog priorizado

### Próximo hito: interfaz de curso y reproductor

- [ ] Diseñar una vista de curso con secciones expandibles, lección actual y progreso por sección.
- [ ] Reemplazar gradualmente los controles nativos por controles visuales propios: reproducción, volumen, velocidad, pantalla completa, siguiente lección y loader.
- [ ] Mantener los eventos nativos del `<video>` aunque cambie la interfaz.
- [ ] Definir experiencia al terminar el último video de un curso.

### Administración del catálogo

- [ ] Crear panel exclusivo para administrador.
- [ ] Editar título, autor, plataforma, fecha, descripción y visibilidad de cursos.
- [ ] Editar títulos y orden de secciones y lecciones sin modificar Drive.
- [ ] Añadir portadas manuales y preparar soporte para portadas generadas desde un frame.
- [ ] Mostrar estado y resultado de cada sincronización de Drive.

### Importación y calidad del catálogo

- [ ] Diseñar la sincronización repetible para el resto de la biblioteca.
- [ ] Detectar y presentar conflictos de orden, carpetas de recursos y archivos no compatibles.
- [ ] Realizar inventario de códecs y tamaños antes de una importación masiva.
- [ ] Definir reglas de normalización que nunca modifiquen archivos de Drive sin decisión explícita.

### Robustez antes de ampliar usuarios

- [ ] Renovar la autorización de Drive sin interrumpir un video largo.
- [ ] Probar reproducción, avance y descarga con archivos grandes y más de un lector.
- [ ] Mostrar errores comprensibles para token vencido, permiso retirado, archivo faltante y formato no compatible.
- [ ] Añadir pruebas automatizadas para orden de lecciones, progreso y notas.
- [ ] Retirar o consolidar las rutas experimentales de los spikes técnicos una vez que ya no sirvan para diagnóstico.

### Funciones futuras

- [ ] Exportar notas por curso o lección.
- [ ] Preferencia persistente de autoplay.
- [ ] Offline integrado: catálogo de archivos descargados, espacio usado y eliminación local.
- [ ] Servidor propio o infraestructura alternativa a Drive.
- [ ] Invitaciones y administración más cómoda de usuarios autorizados.

## Cómo abrir un nuevo chat de trabajo

Abrir un chat por **hito**, no por tarea pequeña. Pegar un enlace a este documento y una petición concreta. Ejemplos:

> Lee `web/docs/ESTADO_Y_BACKLOG.md`. Implementemos el panel de administración para editar metadatos de curso, sin modificar archivos de Google Drive.

> Lee `web/docs/ESTADO_Y_BACKLOG.md`. Diseñemos primero la experiencia visual del reproductor tipo streaming, preservando el `<video>` HTML5 y sus eventos actuales.

Antes de modificar código, revisar este documento, el `README`, las migraciones de Supabase y el estado de Git. No exponer nunca tokens, secretos ni el archivo `.env.local`.
