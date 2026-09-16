# Operación y despliegue de Nébula

**Estado de cierre:** 16 de septiembre de 2026  
**Objetivo:** usar Nébula como biblioteca privada y confiable para la familia, sin repetir trabajo manual en Supabase.

## Estado comprobado

La versión local supera las validaciones de calidad:

| Comprobación | Resultado |
| --- | --- |
| Pruebas automatizadas | 68 aprobadas, 0 fallidas |
| Lint | Sin errores |
| Build de producción | Correcto con Next.js 16.3.4 |
| Biblioteca HLS | 184 paquetes reindexados y revisados |
| HLS | Las listas requeridas por los `master.m3u8` existen en el inventario de Supabase |

Los paquetes HLS se mantienen privados: Drive guarda los archivos y sus IDs; Supabase conserva el índice de rutas; el servidor entrega el contenido solo a usuarios autorizados.

## Flujo normal al agregar contenido

No se pegan IDs de Drive título por título ni se edita Supabase manualmente.

1. Convierte localmente el archivo a un paquete HLS bajo su código interno (`MOV-xxxxx` o `SER-xxxxx-Sxx-Exx`).
2. Comprueba el paquete localmente: debe contener `master.m3u8`, `video/`, `audio/` y los subtítulos disponibles.
3. Sube la carpeta completa a `100_BIBLIOTECA_ENTRETENIMIENTO` en Drive, sin modificar nombres ni estructura.
4. Añade el título o episodio al inventario CSV y usa **Importar inventario y sincronizar** desde Administración.
5. Ejecuta el migrador local para registrar el mapa `ruta relativa → ID de Drive` de los paquetes nuevos:

   ```powershell
   npm run media:migrate
   ```

   Se puede volver a ejecutar: salta los paquetes ya listos. Para rehacer un paquete que fue sustituido o reparado:

   ```powershell
   npm run media:migrate -- --code MOV-00007 --rescan
   ```

6. Prueba una reproducción, audio y subtítulos; después pulsa **Publicar todo lo listo**.

El migrador usa una cuenta de servicio de solo lectura para Drive y una clave privada de Supabase, ambas exclusivamente desde `.env.local`. La guía técnica está en [MEDIA_HLS_LOCAL_MIGRATOR.md](MEDIA_HLS_LOCAL_MIGRATOR.md).

## Antes de publicar la web en Internet

Elegir un proveedor de hosting compatible con Next.js (por ejemplo Vercel) y una URL HTTPS definitiva, como `https://nebula.tudominio.com`. No publiques todavía hasta completar esta lista.

### 1. Configuración de hosting

- Configura en el proveedor las mismas variables de `web/.env.local`, nunca el archivo mismo.
- Incluye las variables de Supabase, Google Drive y TMDB necesarias para el servidor.
- **No** incluyas `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY` en variables públicas (`NEXT_PUBLIC_*`). La cuenta de servicio solo pertenece al migrador local.
- Ejecuta una previsualización de despliegue y después `npm run build` en el proveedor.

### 2. URLs de autenticación

Cuando ya exista la URL pública, añadirla exactamente en estos dos lugares:

| Lugar | Valor necesario |
| --- | --- |
| Supabase → Authentication → URL Configuration → Site URL | `https://TU_DOMINIO` |
| Supabase → Redirect URLs | `https://TU_DOMINIO/**` |
| Google Cloud → OAuth client → Authorized JavaScript origins | `https://TU_DOMINIO` |
| Google Cloud → OAuth client → Authorized redirect URIs | El callback de Supabase: `https://TU_PROJECT_REF.supabase.co/auth/v1/callback` |

Mantén `http://localhost:3000` mientras sigas probando localmente. No reemplaces una URL por otra: añade la de producción junto a la local.

### 3. Permisos de las personas

Para cada familiar:

1. Debe iniciar sesión una vez con su cuenta Google.
2. Un administrador marca esa cuenta como autorizada en Nébula.
3. La cuenta debe tener permiso de **Lector** sobre las carpetas de Drive correspondientes.
4. La primera reproducción autoriza Drive en esa misma cuenta; las renovaciones posteriores ocurren de forma silenciosa mientras Google mantenga la autorización.

La cuenta de servicio del migrador **no** sustituye los permisos de reproducción de las personas: solo sirve para construir el índice privado de Drive.

## Prueba previa de lanzamiento

Con la URL HTTPS de previsualización, ejecutar este recorrido con el administrador y luego con una cuenta lectora:

- [ ] Iniciar y cerrar sesión.
- [ ] Abrir Cursos, Películas y Series.
- [ ] Reproducir una película y un episodio; adelantar, pausar y reanudar.
- [ ] Cambiar audio y activar subtítulos.
- [ ] Recargar normalmente la página y comprobar que la reproducción recupera el acceso.
- [ ] Confirmar que una cuenta lectora no puede abrir `/admin` ni llamadas de administración.
- [ ] Confirmar que los títulos en borrador no aparecen en el catálogo lector.
- [ ] Probar al menos un teléfono usando red móvil, no solo el Wi-Fi de casa.

Si una prueba falla, conservar el mensaje exacto y el código interno del título. No reindexar ni reconvertir toda la biblioteca por un único error.

## Mantenimiento y respaldo

Antes de cambios grandes o cada vez que se incorpore una tanda importante:

```powershell
git status --short
git diff --check
npm test
npm run lint
npm run build
```

- Mantén los CSV de inventario y los archivos de `scripts/output/` como respaldo local, fuera de Git.
- Haz exportaciones periódicas de las tablas de Supabase relacionadas con catálogo y HLS.
- Conserva los originales hasta haber validado el paquete, su subida y su reproducción desde Drive.
- Haz commits pequeños después de cada cambio funcional validado.

## Limpieza no bloqueante

Existen pantallas y rutas heredadas de pruebas (`/drive-pilot`, `/drive-diagnostic`, `/drive-aws-*`, `/drive-sw-*`, `/native-player-test`, `/design-preview` y `/course-demo`). Las APIs de Drive revisadas requieren administrador, por lo que no impiden un despliegue privado. Aun así, conviene retirarlas o esconderlas en una futura tarea de mantenimiento para dejar la aplicación pública más limpia.

## Próximas mejoras, después del lanzamiento

1. Prueba familiar real y corrección de incidencias observadas.
2. Diseño y filtros de catálogo; continuar viendo y búsqueda si se priorizan.
3. Google Cast mediante receptor personalizado y token temporal de reproducción.
4. PWA/offline y una experiencia de TV independiente.