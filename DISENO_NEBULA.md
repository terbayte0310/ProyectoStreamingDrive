# Nébula — Rediseño de experiencia

Fecha: 14 de septiembre de 2026. Estado: implementado en el código local.

## Dirección de producto

Una biblioteca privada para ver, aprender y volver. La experiencia usa una estética cinematográfica sobria: fondo carbón verdoso, texto marfil y acento lima reservado para acciones y progreso. Se conserva Nébula como identidad. La referencia al streaming orienta la jerarquía y los controles, sin prometer capacidades de distribución que Google Drive no proporciona.

Acceso, catálogo, fichas, cuenta, administración y reproducción comparten colores, tipografía, botones, foco y superficies. La administración conserva sus operaciones y estructura funcional; recibe el sistema visual compartido, no una reescritura de su modelo de datos.

## Recorridos

1. Acceso: presentación de películas, series y cursos; una acción para entrar con Google; ausencia de sesión tratada correctamente.
2. Exploración: «Explorar» regresa al catálogo autorizado y «Mi espacio» abre la cuenta. Los módulos siguen dependiendo de permisos reales.
3. Cursos: destacado con acción directa, fila de continuidad y biblioteca con búsqueda, categoría y orden alfabético.
4. Películas y series: títulos editoriales, retícula de portadas, búsqueda y filtro por género principal; ficha completa antes de reproducir.
5. Reproducción: vídeo central, controles superpuestos, ajustes compactos y mensajes accionables. En cursos se conserva temario, avance, siguiente lección, recursos y notas.
6. Administración: acceso por rol y operaciones reales de gestión.

## Sistema visual

| Elemento | Oscuro, predeterminado | Claro, opcional |
| --- | --- | --- |
| Fondo | `#10120f` | `#f5f5ee` |
| Superficie | `#181b16` | `#fffef8` |
| Texto | `#f1f3e9` | `#20251b` |
| Texto secundario | `#a7ae9d` | `#606953` |
| Acción | `#dbf77e` | `#46651c` |

Tipografía de sistema sin descargas de fuentes. Radios de 8–16 px, sombras discretas y bordes para separar superficies. El tema se conserva cuando el almacenamiento está disponible. El vídeo mantiene fondo negro y controles claros en ambos temas.

Las portadas reales se conservan. Cuando faltan, se generan composiciones tipográficas con paletas deterministas. El destacado de cursos solicita prioridad de carga para su imagen.

## Reproductor personalizado

`web/src/components/cinema-player.tsx` es la interfaz compartida. Los consumidores siguen siendo responsables de autorización, origen del vídeo y persistencia.

- Reproducir/pausar y estados derivados de eventos reales del vídeo.
- Línea de tiempo, tramo almacenado en búfer, duración y posición; cálculo seguro ante metadatos desconocidos.
- Saltos de diez segundos, volumen y silencio.
- Velocidades de 0,5× a 2×.
- Pantalla completa y Picture-in-Picture cuando el navegador declara soporte.
- Ocultación de controles durante reproducción; accesibles con foco y visibles en superficies táctiles.
- Atajos al enfocar el área del vídeo: espacio/K, flechas, M y F. No interceptan formularios. Escape cierra ajustes.
- Alternativa a controles nativos para funciones particulares de Safari y dispositivos móviles.
- Audio, subtítulos y calidad HLS según pistas y variantes del manifiesto. No se presentan opciones ficticias.
- Errores fatales HLS visibles, reintento explícito y recuperación de autorización.

La adaptación de calidad sigue a cargo de hls.js. No se implementaron DRM, casting, offline, miniaturas de scrubbing ni saltos de introducción: requieren infraestructura o metadatos adicionales. El progreso de películas y series aún no tiene persistencia equivalente a cursos; está registrado en la auditoría.

## Adaptación y accesibilidad

Escritorio: cursos en cuatro columnas y medios en cinco. Tabletas: menos columnas y temario debajo del vídeo. Móvil: cursos en una columna, medios en dos, filtros flexibles y navegación principal visible. Verificación a 390, 768 y 1440 px sin desplazamiento horizontal de página.

Inputs etiquetados, controles con nombres accesibles, foco visible, resultados anunciados, vacíos recuperables, movimiento reducido y hover según capacidad del dispositivo. No equivale a certificación WCAG: falta revisión con lector de pantalla y dispositivos reales.

## Implementación

| Archivo | Responsabilidad |
| --- | --- |
| `web/src/app/redesign.css` | Tokens y estilos sobre bases existentes |
| `web/src/components/app-header.tsx` | Navegación global |
| `web/src/components/catalog-collection.tsx` | Búsqueda sin acentos, filtros, orden y vacíos |
| `web/src/components/cinema-player.tsx` | Controles compartidos |
| `web/src/components/media-hls-player.tsx` | HLS, pistas y recuperación |
| `web/src/components/course-player-content.tsx` | Aula y aviso de fallo al guardar |
| `web/src/lib/media/player-time.ts` | Formato de tiempo y límites de búsqueda |
| `web/src/app/api/drive-token/media-playback/route.ts` | Ruta compatible con el alcance de cookies |

El CSS nuevo se importa después de `globals.css`. La separación hace revisable el cambio; consolidar ambas hojas por componentes queda recomendado.

## Revisar el resultado

Con `npm run dev` desde `web`, abrir `http://localhost:3000/design-preview`. Galería de desarrollo con datos de ejemplo y componentes reales; en producción devuelve 404. No autentica usuarios ni lee datos privados. Las pantallas funcionales siguen en `/signin`, `/catalog`, `/dashboard`, `/course-player`, `/media-player` y `/admin`.

Capturas y comprobaciones: [auditoría](auditoria_astra/README.md). La prueba visual usa un vídeo sintético local. Google OAuth y reproducción privada no se validaron de extremo a extremo en esta sesión.
