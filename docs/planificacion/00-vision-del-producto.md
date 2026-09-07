# Visión del producto

## Producto

Aplicación web personal y responsive para explorar y reproducir cursos alojados en Google Drive, desde computadora o teléfono, y guardar el progreso de cada lección.

## Problema que resuelve

Los cursos están organizados como archivos y directorios. Encontrar una lección, continuar desde el punto anterior y decidir qué estudiar requiere navegar manualmente por una estructura grande de carpetas. La aplicación debe convertir ese archivo personal en una biblioteca de aprendizaje clara y disponible desde cualquier dispositivo con internet.

## Usuario inicial

Una sola persona: el propietario de los cursos y de la cuenta personal de Google Drive.

Esto es importante: al principio no diseñaremos cuentas para otras personas, pagos, roles, catálogo público ni funciones sociales. Reducir el alcance permite terminar y aprender antes.

## Objetivo de la primera versión

En menos de unos minutos, el usuario debe poder:

1. Abrir la biblioteca desde computadora o teléfono.
2. Encontrar un curso por categoría o búsqueda.
3. Entrar en un curso y ver sus temas y lecciones.
4. Reproducir una lección alojada en Google Drive.
5. Retomar una lección cerca del segundo exacto donde se dejó.

## Indicadores de éxito

- La biblioteca refleja la estructura seleccionada de Google Drive.
- El usuario puede volver a una lección sin buscar manualmente su archivo.
- El progreso persiste al cambiar de dispositivo.
- La experiencia funciona correctamente en pantallas de teléfono y escritorio.

## Alcance inicial

- Aplicación web responsive.
- Conexión con la cuenta personal de Google Drive.
- Catálogo de categorías, cursos, temas y lecciones.
- Reproductor de video.
- Progreso por lección y porcentaje por curso.
- Búsqueda básica.

## Fuera del alcance inicial

- Uso sin conexión.
- Varias cuentas o compartir cursos con otras personas.
- Pagos, suscripciones o catálogo público.
- Recomendaciones automáticas y funciones sociales.
- Edición de archivos de Google Drive desde la aplicación.

## Restricciones conocidas

- Los archivos pertenecen a una cuenta personal de Google Drive con 5 TB disponibles.
- La aplicación debe respetar las capacidades, permisos y límites de la API de Google Drive. Esto se investigará antes de elegir la integración final.
- La primera versión depende de conexión a internet.

## Decisiones pendientes

- Qué estructura exacta tendrá la carpeta raíz en Google Drive.
- Si Google Drive será la fuente única del catálogo o si guardaremos una copia de metadatos en una base de datos.
- Qué tecnología usaremos para la aplicación y dónde se desplegará.
- Cómo se gestionará la autenticación y el acceso seguro a los archivos.
