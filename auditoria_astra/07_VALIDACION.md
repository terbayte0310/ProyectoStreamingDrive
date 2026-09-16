# 07 · Validación y evidencias

## Ejecuciones

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| `npm test` desde web | 57/57 | 55 existentes + 2 de tiempo/seek |
| `npm run lint` | Pasa | Configuración actual |
| `npm run build` | Pasa | Compilación, tipos y rutas de producción |
| `git diff --check` | Pasa | Aviso CRLF en documento previo del usuario |
| `npm audit --omit=dev --json` | 0 avisos | Producción |
| Playwright / Edge Chromium | Pasa | 14 grupos en preview sintética y acceso sin sesión |
| Dimensiones | 390/390, 768/768, 1440/1440 | viewport / scrollWidth |
| Errores JavaScript capturados | 0 | Sesión de UI |

Las pruebas iniciales detectaron un selector de velocidad sin nombre suficientemente preciso y desbordamiento de cabecera. Se ajustaron y la ejecución final pasó.

## Evidencias

- `evidencias/resultado-ui.json`: grupos, dimensiones y errores.
- `evidencias/dependencias.json`: respuesta de npm.
- `evidencias/verificar-ui.cjs`: script reproducible.
- `catalogo-escritorio.png` y `catalogo-claro.png`: temas.
- `catalogo-movil.png`: adaptación móvil.
- `reproductor.png`: vídeo sintético local.
- `acceso.png`: entrada sin sesión.

Las imágenes están en `evidencias/`. `/design-preview` usa componentes reales y datos de ejemplo. `notFound()` la deshabilita fuera de desarrollo; no omite autenticación del catálogo privado.

## Repetir

Desde `web`: `npm run dev`. Desde raíz: `node auditoria_astra/evidencias/verificar-ui.cjs`, con Playwright resoluble en Node y Edge instalado. Si Playwright está en otro directorio, definir `NEBULA_PLAYWRIGHT_PATH` apuntando al paquete. El script no instala paquetes ni autentica cuentas. Genera vídeo con canvas/MediaRecorder en el navegador, sin descargar medios externos.

## Matriz pendiente

| Caso | Estado | Evidencia necesaria |
| --- | --- | --- |
| Google OAuth completo | No ejecutado | Cuenta de ensayo |
| MP4 privado y progreso | No ejecutado con Drive | Restaurar posición tras recarga |
| Película HLS completa | No ejecutado con Drive | Inicio, mitad y final |
| Audio/subtítulos/calidad HLS | Implementado y tipado; sin pistas reales | Manifiesto multiaudio/multivariante y VTT |
| Pantalla completa/PiP | Botones según soporte; prueba manual pendiente | Navegador/dispositivo real |
| Renovación prolongada | Tests existentes del worker; sin sesión larga real | Forzar expiración en ensayo |
| Escaneo por nueva ruta | Revisado/compilado; operación remota pendiente | Cookie y escaneo pequeño exitoso |
| RLS por rol/módulo | SQL y tests estáticos | Base y usuarios de prueba |
| Safari/iOS/Android | No ejecutado | Dispositivos |
| Lector de pantalla | No ejecutado | Navegación anunciada y operable |

No se alteró Supabase ni Google Drive para obtener la evidencia. Estos límites deben acompañar cualquier decisión de despliegue.
