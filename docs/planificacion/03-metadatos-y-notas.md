# Metadatos y notas de aprendizaje

## Principio de datos

Google Drive es la fuente de los archivos y de su estructura física. La aplicación tendrá su propia base de datos para el catálogo, los metadatos editoriales, las portadas, el orden y las notas.

Esto permite mejorar la experiencia sin renombrar, mover ni editar archivos de Google Drive.

Cada dato editable tendrá una procedencia:

- `Detectado`: obtenido desde Google Drive o desde el nombre del archivo o directorio.
- `Personalizado`: modificado por el administrador en la aplicación.

Una sincronización actualizará los datos detectados, pero nunca sobrescribirá un valor personalizado.

## Metadatos del catálogo

### Curso

| Campo | Descripción | Fuente inicial | Editable por administrador |
| --- | --- | --- | --- |
| Título | Nombre visible del curso. | Directorio de curso. | Sí |
| Autor o instructor | Persona, equipo o institución que creó el curso. | Pendiente de completar. | Sí |
| Plataforma de origen | Udemy, YouTube, Platzi u otra plataforma. | Pendiente de completar. | Sí |
| Fecha de publicación | Fecha original del curso cuando se conozca. | Pendiente de completar. | Sí |
| Fecha de incorporación | Cuándo se añadió a la biblioteca. | Google Drive o sincronización. | No |
| Descripción | Resumen breve del contenido y objetivo. | Pendiente de completar. | Sí |
| Categoría | Área principal del curso. | Directorio raíz. | Sí |
| Portada | Imagen automática o personalizada. | Generada o asignada. | Sí |
| Estado visible | Visible u oculto en la biblioteca. | Visible. | Sí |

### Sección o tema

| Campo | Descripción | Editable por administrador |
| --- | --- | --- |
| Título | Nombre visible de la sección. | Sí |
| Descripción | Contexto breve de lo que se aprenderá. | Sí |
| Orden | Posición dentro del curso. | Sí |
| Portada | Imagen opcional de la sección. | Sí |

### Lección o video

| Campo | Descripción | Editable por administrador |
| --- | --- | --- |
| Título visible | Nombre que verá el usuario. | Sí |
| Archivo original | Nombre y referencia del archivo en Drive. | No |
| Tipo de contenido | Video, recurso descargable u otro. | Sí |
| Duración | Duración detectada del video. | Sí, como corrección excepcional |
| Orden | Posición en la secuencia de reproducción. | Sí |
| Subtítulos | Referencia a subtítulos asociados. | Sí |
| Estado visible | Visible u oculto. | Sí |

## Notas de aprendizaje

### Decisión de alcance

Las notas básicas sí formarán parte del MVP porque refuerzan directamente el objetivo de aprendizaje. La exportación y las funciones avanzadas quedarán preparadas para una fase posterior.

### Comportamiento del MVP

1. El usuario pulsa «Añadir nota» mientras ve una lección.
2. La aplicación guarda la nota con el segundo actual de reproducción.
3. La nota queda vinculada solamente al usuario que la creó.
4. En la página de lección, el usuario puede ver, editar y eliminar sus propias notas.
5. Al seleccionar una nota, el reproductor vuelve al segundo asociado.

Un «frame» se representará mediante `segundo_de_video`. Por ejemplo, una nota creada en 13:24 se guardará con el valor `804` segundos. Es una referencia estable incluso si el navegador muestra fotogramas ligeramente distintos.

### Datos de una nota

```text
Nota
├── usuario
├── lección
├── segundo_de_video
├── contenido
├── creada_en
└── actualizada_en
```

Las notas se guardarán en la base de datos de la aplicación, nunca dentro del archivo de video ni en Google Drive.

### Fase posterior de notas

- Exportar notas propias en Markdown, PDF o un formato seleccionable.
- Agrupar notas por curso y sección.
- Etiquetas, favoritos y búsqueda dentro de notas.
- Capturar una miniatura del instante de video junto con la nota.
- Compartir notas, solo si en el futuro se decide habilitar una función social.

## Requisitos añadidos

| ID | Requisito |
| --- | --- |
| RF-17 | El sistema debe mostrar metadatos de curso, sección y lección. |
| RF-18 | El administrador debe poder editar los metadatos visibles sin modificar Google Drive. |
| RF-19 | El sistema debe conservar los metadatos personalizados durante una sincronización. |
| RF-20 | El usuario debe poder crear una nota vinculada al segundo actual de una lección. |
| RF-21 | El usuario debe poder ver, editar y eliminar solo sus propias notas. |
| RF-22 | El usuario debe poder volver al instante de reproducción asociado a una nota. |
