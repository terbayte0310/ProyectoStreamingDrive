# Escalabilidad del catálogo y del administrador

## Hallazgo

`src/app/catalog/page.tsx` consulta en paralelo todas las categorías, cursos, secciones, lecciones y progreso. `src/app/admin/page.tsx` consulta todos los cursos, secciones y lecciones. Ninguna consulta usa `range`, cursor ni una RPC agregada.

Con 2.115 lecciones ya presentes en Drive, el diseño dejó de ser seguro. Supabase limita normalmente la cantidad de filas de una respuesta; aunque el límite del proyecto se elevara, transferir toda la biblioteca para pintar tarjetas es desperdicio de red, memoria y CPU.

## Resultado deseado

### Inicio del catálogo

Una fila por curso con:

- categoría y posición;
- título, descripción, plataforma y portada;
- cantidad de secciones y lecciones visibles;
- lecciones completadas por el usuario;
- porcentaje;
- última lección en progreso;
- primera lección pendiente;
- fecha real de actividad.

Crear preferentemente una función SQL `get_catalog_home()` o una vista/RPC equivalente, ejecutada con los permisos correctos y cubierta por RLS. La respuesta debe crecer por número de cursos, no por número de lecciones.

### Reproductor

Mantener la consulta limitada al `course_id`, pero paginar secciones y lecciones para no depender de que ningún curso tenga menos de 1.000 entradas. Ordenar mediante una clave estable y determinista. Si se usa paginación por rango, aplicar siempre el mismo `order` antes de combinar páginas.

### Administrador

1. Consultar únicamente la lista ligera de cursos.
2. Al seleccionar uno, solicitar sus secciones y lecciones.
3. Renderizar el árbol de ese curso, no el catálogo completo.
4. Para cursos grandes, usar expansión por módulo o virtualización.
5. Invalidar solo los datos del curso modificado después de guardar.

## Compatibilidad con la cola actual

`buildCoursePlaybackQueue` puede seguir siendo la autoridad de orden para un curso. No debe usarse en el inicio con todas las lecciones de todos los cursos. La RPC de inicio puede devolver IDs de destino ya calculados o el servidor puede pedir una cola únicamente para los cursos visibles en la ventana actual.

## Migración recomendada

1. Añadir el trigger faltante para `lesson_progress.updated_at`.
2. Crear índices para las consultas reales, al menos en `(course_id, is_visible, position)` y revisar el índice de progreso `(user_id, updated_at desc)`.
3. Crear la RPC agregada con `security invoker` siempre que RLS permita la consulta.
4. Generar tipos TypeScript desde Supabase; eliminar declaraciones manuales divergentes.
5. Sustituir la consulta masiva del catálogo.
6. Sustituir la consulta masiva del administrador.
7. Probar con más de 2.000 lecciones antes de publicar Drive.

## Pruebas de aceptación

- Un fixture de 2.105 lecciones devuelve conteos completos, no 1.000.
- El HTML inicial del catálogo no contiene miles de lecciones serializadas.
- Un curso situado después de la fila 1.000 aparece y abre su primera lección.
- El administrador puede abrir y editar el último curso importado.
- El porcentaje coincide con un cálculo SQL independiente.
- Cambiar el progreso de una lección actualiza su posición en “Continuar viendo”.
- No se rompe el aislamiento entre dos usuarios.

## Anti-patrones a evitar

- Subir `Max Rows` a 10.000 como única solución.
- Descargar todas las filas y filtrar en React.
- Crear una consulta por tarjeta de curso.
- Usar offsets sin orden determinista.
- confiar en tipos escritos a mano después de cambiar el esquema.

