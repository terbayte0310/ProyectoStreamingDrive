# Flujos y requisitos del MVP

## Decisiones confirmadas

- La biblioteca de cursos pertenece a una sola cuenta personal de Google Drive.
- La aplicación es gratuita y no contempla pagos ni suscripciones.
- Google Drive será solo de lectura desde la aplicación.
- Los amigos autorizados accederán a la misma biblioteca y cada uno tendrá progreso propio.
- El acceso se concederá manualmente: los correos autorizados se compartirán como lectores en Google Drive y se registrarán en una lista de acceso de la aplicación.
- El modo sin conexión queda fuera del MVP. En el futuro se podrá estudiar sin conexión mediante Google Drive o una fase específica de la aplicación.

## Autenticación y autorización

Autenticación responde a «¿quién eres?». La aplicación pedirá al visitante iniciar sesión con Google.

Autorización responde a «¿puedes usar esta aplicación?». Tras iniciar sesión, la aplicación comprobará que el correo pertenece a la lista manual de usuarios autorizados.

| Situación | Resultado esperado |
| --- | --- |
| Usuario no autenticado | Se muestra la opción de iniciar sesión con Google. |
| Usuario autenticado y autorizado | Entra a la biblioteca y ve su propio progreso. |
| Usuario autenticado pero no autorizado | Ve un mensaje claro de acceso no autorizado. No puede ver el catálogo ni abrir lecciones. |

## Flujo principal

1. El usuario abre la aplicación.
2. Inicia sesión con Google si todavía no tiene sesión.
3. La aplicación verifica si está autorizado.
4. El usuario llega al inicio, con sus lecciones recientes y las categorías de la biblioteca.
5. Selecciona una categoría y un curso.
6. Revisa temas y lecciones.
7. Abre una lección y reproduce el video desde Google Drive.
8. La aplicación guarda periódicamente el segundo actual de reproducción.
9. Cuando vuelve, el usuario puede continuar desde ese segundo.

## Pantallas del MVP

### Inicio de sesión

- Botón de inicio de sesión con Google.
- Mensaje breve que explique que el acceso está limitado a usuarios autorizados.

### Inicio

- Sección «Continuar viendo», con las lecciones que el usuario dejó sin terminar.
- Categorías de cursos.
- Búsqueda por nombre de categoría, curso, tema o lección.

### Catálogo y curso

- Vista de las categorías y los cursos que pertenecen a cada una.
- Página de curso con su descripción básica, porcentaje de avance, temas y lecciones.
- Estado visible de cada lección: no iniciada, en curso o terminada.

### Reproductor

- Título de curso, tema y lección.
- Reproducción del archivo permitido por Google Drive.
- Punto de continuación sugerido cuando el usuario vuelve a una lección.
- Guardado automático del progreso sin exigir una acción manual.

### Acceso no autorizado

- Mensaje que confirme que el inicio de sesión funcionó, pero que la cuenta no tiene acceso.
- Indicación de que debe pedir acceso al propietario de la biblioteca.

## Requisitos funcionales

| ID | Requisito |
| --- | --- |
| RF-01 | El sistema debe permitir iniciar sesión con una cuenta de Google. |
| RF-02 | El sistema debe denegar el acceso al catálogo a cuentas que no estén autorizadas. |
| RF-03 | El sistema debe mostrar categorías, cursos, temas y lecciones de la biblioteca configurada. |
| RF-04 | El sistema debe permitir buscar contenido por texto. |
| RF-05 | El sistema debe abrir una lección de video disponible para el usuario en Google Drive. |
| RF-06 | El sistema debe guardar el progreso de una lección asociado al usuario correcto. |
| RF-07 | El sistema debe restaurar el punto de continuación de una lección. |
| RF-08 | El sistema debe calcular y mostrar el progreso de un curso a partir de sus lecciones. |
| RF-09 | El sistema debe funcionar en pantallas de escritorio y teléfono. |

## Requisitos no funcionales iniciales

| ID | Requisito |
| --- | --- |
| RNF-01 | La aplicación no debe modificar, mover ni eliminar contenido en Google Drive. |
| RNF-02 | La aplicación debe solicitar solo los permisos mínimos necesarios de Google. |
| RNF-03 | El progreso de un usuario no debe poder ser visto ni modificado por otro usuario. |
| RNF-04 | La aplicación debe comunicar con claridad errores de acceso, archivo no disponible o conexión perdida. |
| RNF-05 | La aplicación debe ser utilizable con conexión a internet en teléfono y escritorio. |

## Fuera del alcance del MVP

- Gestión de pagos o suscripciones.
- Registro público o autoaprobación de usuarios.
- Compartir cursos desde la aplicación, catálogo público o funciones sociales.
- Edición, movimiento o eliminación de archivos de Google Drive desde la aplicación.
- Descarga y reproducción sin conexión dentro de la aplicación.
- Recomendaciones automáticas.
