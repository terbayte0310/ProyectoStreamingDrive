# Auditoría de preparación para uso doméstico

**Fecha de corte:** 9 de septiembre de 2026  
**Estado evaluado:** rama `master`, interfaz renovada aún sin commit, Supabase remoto y biblioteca de Google Drive real.  
**Veredicto:** beta funcional para los cuatro cursos publicados; no publicar todavía el snapshot masivo.

## Propósito de esta carpeta

Este paquete es el punto de entrada para cualquier agente que continúe el proyecto. No debe asumir que una compilación correcta equivale a que el producto esté listo. Antes de cambiar código debe reconstruir la situación real descrita aquí, revisar el worktree y preservar los archivos personales no versionados.

## Evidencia observada

| Capa | Categorías | Cursos | Contenido |
| --- | ---: | ---: | ---: |
| `D:\SUBIR` | 25 | 73 | 20.776 archivos |
| Google Drive, previsualización de solo lectura | 11 | 29 | 2.115 lecciones, 242 secciones |
| Catálogo publicado en Supabase | 2 | 4 | 144 lecciones |

La previsualización real también devolvió 3.887 elementos auxiliares/no compatibles, 39 ignorados y 0 conflictos. Tardó 6,8 minutos. No se publicó ese snapshot.

## Regla de seguridad para el siguiente agente

1. No pulsar ni invocar `publish` hasta resolver las consultas sin paginación.
2. No mover, eliminar ni convertir archivos de `D:\SUBIR`, Drive o los respaldos sin petición explícita.
3. No versionar `.env.local`, tokens, `web/supabase/.temp` ni inventarios con rutas personales.
4. No reescribir cambios existentes del usuario. El worktree está sucio y la renovación visual aún no tiene commit.
5. Antes de una migración, preparar prueba SQL, ruta de reversión y copia de seguridad lógica.

## Orden de lectura

1. [01-estado-y-veredicto.md](01-estado-y-veredicto.md)
2. [02-escalabilidad-de-datos.md](02-escalabilidad-de-datos.md)
3. [03-sincronizacion-drive.md](03-sincronizacion-drive.md)
4. [04-progreso-auth-y-seguridad.md](04-progreso-auth-y-seguridad.md)
5. [05-despliegue-operacion-y-respaldo.md](05-despliegue-operacion-y-respaldo.md)
6. [06-producto-ux-y-pruebas.md](06-producto-ux-y-pruebas.md)
7. [07-plan-de-ejecucion-para-agentes.md](07-plan-de-ejecucion-para-agentes.md)

## Definición de “listo para casa”

El producto estará listo cuando pueda arrancar tras reiniciar el PC, abrirse con HTTPS desde un teléfono, mostrar todo lo publicado sin truncamiento, guardar progreso sin fallos silenciosos, cerrar completamente las credenciales, recuperarse de un error de sincronización y restaurarse desde copias verificadas.

