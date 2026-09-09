# Progreso, autenticación y seguridad

## Progreso

### Defecto confirmado por lectura de código

`lesson_progress` tiene un campo `updated_at` y un índice que lo usa, pero no tiene trigger `set_updated_at`. El cliente hace `upsert` sin enviar ese campo. Por tanto, las actualizaciones posteriores pueden conservar la fecha de creación.

### Corrección

Crear una migración:

```sql
create trigger lesson_progress_set_updated_at
before update on public.lesson_progress
for each row execute function public.set_updated_at();
```

El guardado del reproductor debe comprobar el resultado de Supabase. Si falla, conservar el último punto pendiente y reintentar con límite; mostrar un estado discreto “Guardado / Sin conexión / Reintentando”. Añadir guardado al pausar, cambiar de lección, `visibilitychange` y `pagehide`. No afirmar que se guardó si la respuesta falló.

No degradar un estado `completed` a `in_progress` por un evento tardío. Centralizar esta regla en una RPC o restricción probada.

## Autenticación

El acceso Google → callback → catálogo fue validado. El Proxy renueva cookies de Supabase. Aun así:

- la página de login debe interpretar `?error=oauth_callback`;
- el callback exitoso y fallido debe usar `Cache-Control: private, no-store`;
- deben probarse código reutilizado, estado vencido, usuario bloqueado y caída de Supabase;
- las URL de producción deben estar registradas exactamente en Supabase y Google.

## Logout completo

El botón actual solo llama `supabase.auth.signOut()`. Implementar una ruta de servidor que:

1. valide la sesión;
2. elimine `drive_provider_token`, `drive_provider_refresh_token` y `drive_provider_user_id`;
3. responda sin caché;
4. ordene al Service Worker borrar `driveAccessToken`;
5. cierre Supabase;
6. redirija a `/signin`.

Agregar al Service Worker un mensaje explícito `clear-drive-access-token`. Considerar revocación en Google como una acción separada, descrita claramente al usuario.

## Tokens de Drive

El refresh token se conserva 180 días en una cookie `httpOnly`, `sameSite=lax` y `secure` en producción. Es razonable para una beta personal, pero no coincide con la arquitectura documentada de almacenamiento cifrado en servidor.

Opciones:

- corto plazo: conservar la cookie, añadir logout completo, CSP y rotación;
- largo plazo: guardar el refresh token cifrado por usuario en servidor/Vault, nunca en una tabla legible por el cliente.

El scope `drive.readonly` concede lectura amplia. Mantener la aplicación sin scripts de terceros y revisar cuidadosamente cualquier dependencia añadida.

## RLS

Las políticas de progreso, notas y preferencias verifican `user_id = auth.uid()`, pero deberían exigir también `public.is_authorized_user()`. Una cuenta autenticada y bloqueada no debe poder escribir filas aunque conozca un UUID.

Crear pruebas SQL para:

- lector A no puede leer/escribir progreso de B;
- cuenta no autorizada no puede crear progreso o notas;
- lector no puede modificar catálogo;
- administrador autorizado sí puede;
- eliminar autorización corta acceso inmediatamente.

## Encabezados y navegador

La respuesta local no incluye CSP, `X-Content-Type-Options`, `Referrer-Policy` ni `Permissions-Policy`, y expone `X-Powered-By`. Configurar encabezados en `next.config.ts`, desactivar `poweredByHeader` y diseñar una CSP compatible con Supabase, Google OAuth, Drive Media y el Service Worker. Probarla primero en modo report-only.

## Criterios de aceptación

- “Cerrar sesión” hace imposible reproducir otra petición con el token anterior.
- El progreso reciente cambia de orden correctamente.
- Una caída temporal muestra error y luego guarda sin duplicar.
- Una cuenta no autorizada no puede escribir datos privados.
- No aparecen secretos en logs, HTML, URLs o Git.

