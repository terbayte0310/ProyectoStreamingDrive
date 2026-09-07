# Modelo de datos conceptual

## Qué es este modelo

Un modelo de datos describe las entidades que necesita la aplicación y sus relaciones antes de elegir tablas, proveedor de base de datos o código.

Su propósito es responder preguntas como: «¿a quién pertenece este progreso?», «¿qué lección sigue después?» y «¿qué edición del administrador debe sobrevivir a la próxima sincronización?».

## Relación principal

```text
Usuario ─────< Progreso >───── Lección ─────> Módulo ─────> Curso ─────> Categoría
   │                             │              │
   ├─────< Nota >────────────────┘              └─────> Módulo padre
   │
   └─────< Preferencia de reproducción

Curso / Módulo / Lección ─────< Portada
Curso / Módulo / Lección ─────< Datos detectados de Google Drive
```

El símbolo `<` significa «puede tener muchos». Un usuario puede tener muchos progresos y muchas notas; una lección puede tener progreso y notas de muchos usuarios, pero cada registro pertenece a una sola persona.

## Entidades

### Usuario

Representa a una persona que inició sesión con Google.

| Campo conceptual | Uso |
| --- | --- |
| ID interno | Identificador estable de la aplicación. |
| ID de Google | Vincula de forma segura la cuenta autenticada. |
| Correo | Sirve para reconocer y autorizar al usuario. |
| Rol | `ADMINISTRADOR` o `LECTOR`. |
| Estado de acceso | Autorizado o bloqueado. |
| Creado y último acceso | Útil para el panel administrativo. |

No guardaremos contraseñas: Google se encarga de autenticar la identidad.

### Categoría

Agrupa cursos, por ejemplo React, Python o Adobe. Su título, orden, visibilidad y portada pueden personalizarse sin alterar la carpeta de Drive.

### Curso

Representa una unidad de aprendizaje, normalmente un directorio de curso en Drive.

Además de sus metadatos, mantiene la referencia al `ID de carpeta de Drive`. Usar el ID —en vez de depender solo de una ruta como `React/Curso X`— permite detectar cambios de nombre o ubicación sin perder el vínculo con el curso.

### Módulo

Un módulo representa cualquier directorio dentro de un curso: Fase 1, sección, capítulo o subtema. Un módulo puede tener otro módulo como padre.

Esta relación consigo mismo (`módulo padre`) permite reflejar una jerarquía de carpetas de cualquier profundidad, no solo Curso → Fase → Video. Es la base para que la reproducción automática pase correctamente de la última lección de una fase a la primera de la siguiente.

Cada curso tendrá un módulo raíz interno. Ese módulo organiza lecciones que estén directamente en la carpeta del curso, aunque no sea necesario mostrarlo en la interfaz.

### Lección

Representa una unidad reproducible, normalmente un archivo de video.

| Campo conceptual | Uso |
| --- | --- |
| ID de archivo de Drive | Referencia estable al video original. |
| Módulo | Ubicación lógica dentro del curso. |
| Título detectado y título personalizado | Nombre original y nombre visible. |
| Tipo y duración | Permiten decidir si se reproduce y cómo se presenta. |
| Posición automática y posición personalizada | Construyen el orden de la lista de reproducción. |
| Estado | Disponible, oculto, no encontrado o no reproducible. |
| Archivo de subtítulos | Referencia opcional al subtítulo asociado. |

Una lección puede conservar su archivo original aunque el administrador cambie el título visible o su posición.

### Progreso

Es el estado de visualización de una lección para un usuario.

| Campo conceptual | Uso |
| --- | --- |
| Usuario y lección | Identifican de quién y de qué contenido es el progreso. |
| Segundo actual | Punto de continuación. |
| Duración conocida | Permite calcular porcentaje. |
| Estado | No iniciado, en curso o terminado. |
| Actualizado en | Permite ordenar «Continuar viendo». |

La combinación `usuario + lección` debe ser única: una persona solo puede tener un punto actual por lección.

### Nota

Una nota pertenece a un usuario y a una lección. Guarda `segundo de video`, texto, fecha de creación y última actualización.

El texto se almacenará en un formato sencillo compatible con exportación futura, como texto plano o Markdown. En el MVP se mostrará como texto; el diseño no impide añadir formato después.

### Preferencia de usuario

Guarda decisiones personales, comenzando por `reproducción automática activada o desactivada`. Debe pertenecer al usuario, no al dispositivo, para que la preferencia se conserve al cambiar de teléfono a computadora.

### Portada

Representa una imagen asignada a una categoría, curso o módulo.

| Campo conceptual | Uso |
| --- | --- |
| Elemento cubierto | Categoría, curso o módulo. |
| Origen | Automática, personalizada o predeterminada. |
| Ubicación de imagen | Referencia al almacenamiento de la aplicación. |
| Fuente de fotograma | Lección y segundo usados para una portada automática. |

Las portadas son datos de la aplicación; no se escriben en Google Drive.

### Fuente de biblioteca y sincronización

Hay una sola fuente de biblioteca configurada: la carpeta raíz de tu Google Drive.

Se guardarán el ID de esa carpeta, la fecha del último escaneo, el resultado y los errores. Esto permitirá al administrador saber si el catálogo está actualizado sin exponer ni modificar archivos.

## Regla de sincronización

```text
Leer Drive en modo solo lectura
→ Convertir directorios en módulos y videos en lecciones
→ Ordenar de forma natural
→ Encontrar elementos existentes por ID de Drive
→ Actualizar solo información detectada
→ Conservar títulos, orden, visibilidad y portadas personalizados
→ Marcar archivos ausentes, sin borrar progreso ni notas
→ Construir lista de reproducción de cada curso
```

No se eliminarán automáticamente registros de la aplicación cuando desaparezca un archivo de Drive. Se marcarán como no encontrados para que el administrador pueda revisarlos sin perder notas ni progreso histórico.

## Decisiones que este modelo habilita después

- Exportar notas por usuario, curso, módulo o lección.
- Agregar búsqueda por metadatos y contenido de notas.
- Añadir nuevos niveles de carpetas sin cambiar el modelo.
- Añadir más preferencias personales.
- Incorporar nuevas fuentes de contenido en el futuro sin rediseñar progreso y notas.
