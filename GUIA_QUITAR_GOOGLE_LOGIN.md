# Guía end-to-end: quitar Google como método de inicio de sesión

**Proyecto:** Nébula (`web/`) · **Fecha:** 17 de septiembre de 2026
**Tipo:** solo guía. Nada de esto está aplicado en el código todavía.
**Resultado final:** los usuarios entran con **su correo + un código de 6 dígitos** (sin contraseñas, sin pasar por Google) y los vídeos se siguen leyendo de Google Drive mediante una **cuenta de servicio** del servidor. Todo gratis.

---

## 1. Por qué hoy es lento y qué hace realmente Google en Nébula

Hoy el botón “Continuar con Google” hace **dos trabajos a la vez**:

1. **Identidad:** Supabase Auth crea/abre la sesión del usuario (`signInWithOAuth` en `web/src/components/sign-in-panel.tsx`).
2. **Permiso de Drive:** en el mismo inicio de sesión se pide el alcance `drive.readonly` con `access_type=offline` y **`prompt=consent`** (`web/src/lib/auth/google-oauth.ts`). El callback (`web/src/app/auth/callback/route.ts`) guarda el token y el *refresh token* de Google de ese usuario en cookies HttpOnly (`drive_provider_token`, `drive_provider_refresh_token`, `drive_provider_user_id`, `web/src/lib/drive/session.ts`). Todo el streaming usa **el Drive de cada usuario**.

Por eso tarda:
- Cadena de redirecciones: Nébula → Supabase → Google (elegir cuenta) → **pantalla de consentimiento de Drive cada vez** (`prompt=consent` la fuerza siempre) → Supabase → `/auth/callback` → `/catalog` → `/catalog/cursos`.
- Cada usuario necesita que los archivos de la biblioteca estén **compartidos con su cuenta de Google**, y si revoca o caduca el permiso, aparece “Hay que renovar el acceso”.

**Quitar Google implica sustituir las dos cosas:**

| Trabajo | Hoy | Después |
|---|---|---|
| Identidad | Google OAuth vía Supabase | **Correo + código OTP** de Supabase Auth |
| Leer Drive | Token del Drive de cada usuario (cookies) | **Cuenta de servicio** del proyecto (token emitido por el servidor) |

> Atajo temporal si solo quieres que el login con Google sea más rápido sin quitarlo: en `web/src/lib/auth/google-oauth.ts` cambia `prompt: "consent"` por `prompt: "select_account"`. Google deja de mostrar la pantalla de permisos en cada entrada. Riesgo: Google solo entrega *refresh token* la primera vez; si un usuario borra cookies tendrá que revocar el acceso en <https://myaccount.google.com/permissions> y volver a entrar. Es un parche; la solución real es esta guía.

---

## 2. Arquitectura objetivo

```text
Inicio de sesión
  Usuario escribe su correo ─► Supabase envía código ─► Usuario escribe el código ─► sesión (cookies de Supabase)
  (sin redirecciones, 2 pantallas, ~10 s en total)

Reproducción
  Service worker ──► /api/drive-token ──► (usuario autorizado + módulo) ──► token de la CUENTA DE SERVICIO (1 h, en caché)
  Service worker ──► Google Drive (segmentos HLS / rangos de MP4)       ← igual que hoy
  Proxy del servidor (respaldo) ──► token de la cuenta de servicio      ← ya no depende de cookies de Google
```

Lo que **no cambia**: tablas, RLS, módulos (`user_module_access`), perfiles (`profiles`), el fusible de transferencia, el reproductor, el service worker y la entrega directa de HLS. `profiles.id` sigue siendo `auth.users.id`, así que **los usuarios actuales conservan su rol, módulos, progreso y notas**.

### Decisión de seguridad (léela antes de empezar)
El token de la cuenta de servicio se entrega al service worker de cada usuario autorizado (como hoy se entrega el token de su propio Drive). Quien lo extraiga con herramientas de desarrollo podría leer **lo que esté compartido con la cuenta de servicio** durante máximo 1 hora.

- Comparte con la cuenta de servicio **solo** las carpetas de la biblioteca (cursos y `100_BIBLIOTECA_ENTRETENIMIENTO`), nunca tu Drive completo.
- Hoy el token de cada usuario tiene `drive.readonly` sobre **todo su Drive personal**: la cuenta de servicio es un alcance más pequeño.
- Si quieres que ningún token salga del servidor, fuerza el modo proxy (ver `AUDITORIA_CLAUDE.md` §6). Es más seguro pero más lento y consume la cuota de Vercel.

---

## 3. Requisitos previos (15 min)

- Acceso de propietario al proyecto de Supabase y al proyecto de Vercel.
- El proyecto de Google Cloud donde vive la cuenta de servicio existente. El repositorio ya la usa: `web/biblioteca-de-cursos-507900-eb3747da92e0.json` (ignorado por Git) y las variables `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` que usa `web/scripts/migrate-hls-drive.mjs`.
- Un proveedor SMTP gratuito (paso 5.3). El SMTP incluido en Supabase tiene un límite de envíos por hora muy bajo pensado solo para pruebas.
- Una rama nueva: `git switch -c feat/login-sin-google`.

---

## 4. Paso 1 — Preparar la cuenta de servicio de Drive (Google Cloud)

1. En Google Cloud Console → *APIs & Services → Library*: confirma que **Google Drive API** está habilitada en el proyecto de la cuenta de servicio.
2. *IAM & Admin → Service Accounts*: copia el correo de la cuenta (termina en `@…iam.gserviceaccount.com`). Es el mismo valor que `client_email` del JSON.
3. En Google Drive (con la cuenta propietaria de la biblioteca), **comparte como Lector** con ese correo:
   - La carpeta raíz de cursos (`GOOGLE_DRIVE_ROOT_FOLDER_ID`).
   - La carpeta raíz de películas/series (`HLS_DRIVE_ROOT_FOLDER_ID`, normalmente `100_BIBLIOTECA_ENTRETENIMIENTO`).
   - Si alguna está en una **unidad compartida**, añade la cuenta como *Lector* de la unidad. El código ya usa `supportsAllDrives=true`.
4. Comprueba el acceso desde tu PC (no toca la web). Guarda esto como `web/scripts/check-drive-sa.mjs`:

```js
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n") },
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const drive = google.drive({ auth, version: "v3" });
for (const folder of [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID, process.env.HLS_DRIVE_ROOT_FOLDER_ID].filter(Boolean)) {
  const { data } = await drive.files.list({ fields: "files(id,name)", includeItemsFromAllDrives: true, pageSize: 5, q: `'${folder}' in parents`, supportsAllDrives: true });
  console.log(folder, data.files);
}
```

   y ejecútalo:

```powershell
cd web
node --env-file=.env.local scripts/check-drive-sa.mjs
```

   Debe imprimir nombres de archivos. Si responde `File not found`, falta compartir la carpeta.

5. En Vercel → *Project → Settings → Environment Variables* (Production y Preview) añade:
   - `GOOGLE_CLIENT_EMAIL` = el `client_email`.
   - `GOOGLE_PRIVATE_KEY` = el `private_key` **completo**, con los saltos de línea escritos como `\n` (el código los convierte).
   - Mantén `GOOGLE_DRIVE_ROOT_FOLDER_ID` y `HLS_DRIVE_ROOT_FOLDER_ID`.

> Rota la clave si alguna vez estuvo fuera de tu PC: *Service account → Keys → Add key → JSON*, actualiza las variables y borra la clave vieja.

---

## 5. Paso 2 — Configurar Supabase Auth para correo + código

### 5.1 Activar el proveedor de correo
*Supabase Dashboard → Authentication → Sign In / Providers → Email*:
- **Enable Email provider:** activado.
- **Confirm email:** activado.
- **Email OTP expiration:** 600 s (10 min) es un buen equilibrio.
- **Email OTP length:** 6.

### 5.2 Cerrar el registro público (solo por invitación)
*Authentication → Sign In / Providers → User Signups*:
- **Allow new users to sign up:** **desactivado**. Solo podrán entrar cuentas que ya existan. Los usuarios actuales (creados por Google) **ya existen** en `auth.users`, así que siguen pudiendo entrar.

En el código se refuerza con `shouldCreateUser: false` (paso 7).

### 5.3 SMTP gratuito (imprescindible para que sea rápido)
*Project Settings → Authentication → SMTP Settings → Enable Custom SMTP*. Opciones gratuitas habituales (verifica sus límites actuales):
- **Resend** (capa gratuita con cuota diaria/mensual; requiere verificar un dominio).
- **Brevo** (capa gratuita con cuota diaria).
- **Gmail** con *contraseña de aplicación* (cuenta con verificación en 2 pasos): host `smtp.gmail.com`, puerto `465`, usuario tu Gmail, contraseña de aplicación. Suficiente para 6 usuarios.

Después, en *Authentication → Rate Limits*, sube “Emails sent per hour” a un valor cómodo (p. ej. 30).

### 5.4 Plantilla del correo con el código
*Authentication → Emails → Templates → Magic Link* (es la que usa `signInWithOtp`). Sustituye el cuerpo por:

```html
<h2>Tu código para entrar a Nébula</h2>
<p style="font-size:32px;font-weight:700;letter-spacing:8px">{{ .Token }}</p>
<p>Caduca en 10 minutos. Si no lo pediste, ignora este correo.</p>
```

Al incluir `{{ .Token }}` y no `{{ .ConfirmationURL }}`, Supabase envía un **código** en lugar de un enlace. No hace falta ninguna ruta de callback.

### 5.5 URLs
*Authentication → URL Configuration*: `Site URL` = tu dominio de producción. Las *Redirect URLs* de Google se pueden dejar hasta el final (paso 10).

### 5.6 Dar de alta usuarios nuevos (a partir de ahora)
*Authentication → Users → Add user → Create new user*: correo, sin contraseña, **Auto Confirm User** activado. El trigger `handle_new_user` (migración `20260906210000_initial_access.sql`) crea su fila en `profiles`. Luego, como hasta ahora, en el SQL Editor:

```sql
update public.profiles set is_authorized = true where email = 'persona@ejemplo.com';
insert into public.user_module_access (user_id, module)
select id, 'movies'::public.library_module from public.profiles where email = 'persona@ejemplo.com'
on conflict do nothing;
```

---

## 6. Paso 3 — Token de Drive desde el servidor (código)

### 6.1 Nuevo módulo `web/src/lib/drive/service-account.ts`
Sin dependencias pesadas: firma el JWT con `node:crypto` (evita cargar `googleapis` en cada función, que alarga el arranque en frío).

```ts
import "server-only";

import { createSign } from "node:crypto";

const scope = "https://www.googleapis.com/auth/drive.readonly";
const tokenUrl = "https://oauth2.googleapis.com/token";

let cached: { expiresAt: number; token: string } | null = null;
let pending: Promise<string> | null = null;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

async function requestToken() {
  const email = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!email || !key) throw new Error("Falta GOOGLE_CLIENT_EMAIL o GOOGLE_PRIVATE_KEY.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ aud: tokenUrl, exp: now + 3600, iat: now, iss: email, scope }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(key).toString("base64url")}`;
  const response = await fetch(tokenUrl, {
    body: new URLSearchParams({ assertion, grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer" }),
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !data.access_token) throw new Error("Google rechazó el token de la cuenta de servicio.");
  cached = { expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, token: data.access_token };
  return data.access_token;
}

/** Token de solo lectura de la cuenta de servicio, reutilizado mientras le queden > 5 min. */
export async function getServiceAccountToken() {
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  pending ??= requestToken().finally(() => { pending = null; });
  return pending;
}
```

### 6.2 `web/src/app/api/drive-token/route.ts`
Conserva la comprobación de sesión y de módulo; elimina todo lo de cookies de Google:

```ts
import { NextRequest, NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/access";
import { getServiceAccountToken } from "@/lib/drive/service-account";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  const requestedModule = request.nextUrl.searchParams.get("module") ?? "courses";
  if (requestedModule !== "courses" && requestedModule !== "movies" && requestedModule !== "series") {
    return NextResponse.json({ error: "El módulo solicitado no es válido." }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: hasModule, error } = await supabase.rpc("has_module_access", { p_module: requestedModule });
  if (error || !hasModule) return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 });
  try {
    const accessToken = await getServiceAccountToken();
    return NextResponse.json({ accessToken }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Drive no está disponible en este momento." }, { status: 503 });
  }
}
```

> Importante: responde **503** (no 401) si falla Google. El reproductor interpreta 401 como “sesión caducada”.

### 6.3 `web/src/lib/drive/media-hls.ts` — `getDriveTokenForMedia`
Mantén la firma para no tocar a quien la llama (proxy HLS, escaneo y lotes de administración):

```ts
import { getServiceAccountToken } from "@/lib/drive/service-account";

export async function getDriveTokenForMedia(_request: NextRequest, _userId: string) {
  return getServiceAccountToken();
}
```

Borra los imports de cookies (`DRIVE_ACCESS_COOKIE`, `DRIVE_REFRESH_COOKIE`, `DRIVE_USER_COOKIE`, `refreshDriveAccessToken`) de ese archivo.

### 6.4 Sincronización de cursos (administración)
Tres rutas leen hoy el *refresh token* del administrador desde cookies:
- `web/src/app/api/drive-token/sync/route.ts` (líneas ~41–61)
- `web/src/app/api/drive-token/sync/jobs/route.ts` (línea ~44)
- `web/src/app/api/drive-token/sync/jobs/[jobId]/run/route.ts` (líneas ~41–48 y la función `respond`, que vuelve a escribir cookies)

En las tres:
1. Elimina la comprobación `request.cookies.get(DRIVE_USER_COOKIE) … DRIVE_REFRESH_COOKIE`.
2. Sustituye `const token = await refreshDriveAccessToken(refreshToken)` por `const accessToken = await getServiceAccountToken()` y usa `accessToken` donde antes se usaba `token.access_token`.
3. En `respond(...)` quita `setDriveSessionCookies(...)`.
4. Mantén `requireAdminAccess`/`getCurrentAccess` (el permiso de administrador no cambia).

### 6.5 Configuración de Drive — `web/src/lib/drive/config.ts`
Hoy exige `GOOGLE_DRIVE_CLIENT_ID` y `GOOGLE_DRIVE_CLIENT_SECRET`. Cámbialo para exigir solo `GOOGLE_DRIVE_ROOT_FOLDER_ID` (y que `service-account.ts` valide `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`). Busca usos de `getDriveConfig()` con:

```powershell
cd web
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "getDriveConfig" -List
```

y elimina las referencias a `clientId`/`clientSecret`.

---

## 7. Paso 4 — Nueva pantalla de acceso (correo → código)

Sustituye la lógica de `web/src/components/sign-in-panel.tsx` (el diseño visual del panel se conserva: `auth-card`, `btn`, `input`, `notice`). Flujo:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignInPanel() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const { error } = await createSupabaseBrowserClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false }, // solo cuentas dadas de alta
    });
    setBusy(false);
    // Mismo mensaje exista o no la cuenta: no revela qué correos están registrados.
    if (error && error.status !== 400 && error.status !== 422) { setMessage("No se pudo enviar el código. Inténtalo en un minuto."); return; }
    setStep("code");
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const { error } = await createSupabaseBrowserClient().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) { setMessage("Código incorrecto o caducado."); return; }
    router.replace("/catalog");
    router.refresh();
  }

  return step === "email" ? (
    <form onSubmit={sendCode}>
      <input autoComplete="email" className="input" inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required type="email" value={email} />
      <button className="btn btn-primary btn-lg btn-block" disabled={busy} type="submit">{busy ? "Enviando…" : "Enviarme un código"}</button>
      {message ? <p className="notice notice-error">{message}</p> : null}
    </form>
  ) : (
    <form onSubmit={verify}>
      <p>Te enviamos un código a <strong>{email}</strong>.</p>
      <input autoComplete="one-time-code" className="input mono" inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} pattern="\d{6}" placeholder="000000" required value={code} />
      <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6} type="submit">{busy ? "Comprobando…" : "Entrar"}</button>
      <button className="btn btn-ghost btn-block" onClick={() => setStep("email")} type="button">Usar otro correo</button>
      {message ? <p className="notice notice-error">{message}</p> : null}
    </form>
  );
}
```

Detalles de UX recomendados:
- `autoComplete="one-time-code"` permite que iOS/Android rellenen el código desde la notificación del correo.
- Un botón “Reenviar código” deshabilitado 60 s (Supabase limita reenvíos).
- Recuerda el último correo en `localStorage` para prellenarlo.

---

## 8. Paso 5 — Limpieza del flujo de Google en el código

| Archivo | Acción |
|---|---|
| `web/src/lib/auth/google-oauth.ts` | Borrar |
| `web/test/google-oauth.test.ts` | Borrar (o sustituir por un test del nuevo panel) |
| `web/src/lib/auth/drive-oauth.ts` | Borrar |
| `web/src/app/auth/drive-callback/route.ts` | Borrar |
| `web/src/app/auth/callback/route.ts` | Con OTP ya no se usa. Déjalo solo si vas a usar enlaces mágicos o invitaciones por correo; en ese caso quita todo el bloque de `provider_token`/`setDriveSessionCookies` y deja únicamente `exchangeCodeForSession` + redirección a `/catalog` |
| `web/src/components/media-inventory-import.tsx` | Quitar el aviso y el botón “Reconectar Google Drive” (`needsDrive`, `reconnectGoogleDrive`) |
| `web/src/lib/drive/session.ts` | Mantén `clearDriveSessionCookies` unas semanas (la ruta `/api/session/sign-out` la llama y así se limpian cookies antiguas); después bórralo junto con las constantes |
| `web/src/app/drive-access/page.tsx`, `web/src/app/api/drive/*` (piloto/diagnóstico con OAuth) | Rutas de diagnóstico antiguas: bórralas o déjalas fuera de uso; ninguna página del producto las enlaza |
| `web/.env.local.example` | Quitar `GOOGLE_DRIVE_CLIENT_ID` y `GOOGLE_DRIVE_CLIENT_SECRET`; documentar `GOOGLE_CLIENT_EMAIL` y `GOOGLE_PRIVATE_KEY` |
| Textos | En `sign-in-panel.tsx` y en `nebula-player.tsx` (“Hay que renovar el acceso”) ya no se menciona Google; revisa que ningún texto diga “Continuar con Google” |

Comprobación final de que no queda nada:

```powershell
cd web
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "signInWithOAuth|provider_token|drive_provider|GOOGLE_DRIVE_CLIENT"
```

No debe devolver resultados (salvo las rutas de diagnóstico si decidiste conservarlas).

---

## 9. Paso 6 — Pruebas end-to-end

Ejecuta en local (`npm run dev`) y luego en una *Preview* de Vercel:

1. **Acceso:** correo de un usuario existente → llega el código en < 30 s → entra al catálogo. Correo inexistente → la interfaz muestra lo mismo pero nunca llega correo (no revela cuentas).
2. **Usuario antiguo de Google:** entra con el mismo correo; conserva módulos, progreso de cursos (`lesson_progress`) y notas.
3. **Cursos:** abre una lección; en DevTools → *Network* aparecen lecturas a `googleapis.com` servidas por el service worker. Cambia de lección: sin recarga.
4. **Películas/Series:** reproduce; segmentos `/drive-hls/…` desde el service worker. Cambia de audio y subtítulos.
5. **Respaldo por proxy:** en DevTools → *Application → Service workers* marca “Bypass for network” y recarga el reproductor: debe seguir reproduciendo vía `/api/drive-token/media-playback/packages/…` (ahora con el token de la cuenta de servicio).
6. **Administración:** *Administrar cursos → Sincronizar Drive → Buscar cursos nuevos* y *Películas y Series → Fuentes → Sincronizar paquetes pendientes*: ambos funcionan sin pedir reconexión a Google.
7. **Permisos:** un usuario sin el módulo *Películas* no obtiene token (`/api/drive-token?module=movies` → 403) ni ve el catálogo.
8. **Cierre de sesión:** “Cerrar sesión” en el menú de cuenta vuelve a `/signin` en todas las pestañas.
9. `npm test`, `npx tsc --noEmit`, `npx eslint src` y `npx next build` en verde.

---

## 10. Paso 7 — Despliegue y retirada de Google

1. **Despliega** la rama a producción con las variables del paso 4.5 ya configuradas.
2. **Periodo de convivencia (opcional, recomendado 1 semana):** deja el proveedor Google activo en Supabase pero sin botón en la interfaz. Si algo falla, basta con revertir el despliegue.
3. **Desactiva Google en Supabase:** *Authentication → Sign In / Providers → Google → Disable*.
4. **Google Cloud (proyecto del OAuth):** en *APIs & Services → Credentials*, elimina el cliente OAuth web que usaba Supabase (o quita sus *redirect URIs*). **No borres** la cuenta de servicio ni desactives la Drive API.
5. **Vercel:** elimina `GOOGLE_DRIVE_CLIENT_ID` y `GOOGLE_DRIVE_CLIENT_SECRET`.
6. **Usuarios:** pueden retirar el permiso antiguo de Nébula a su Drive en <https://myaccount.google.com/permissions>. Ya no hace falta compartir la biblioteca con sus cuentas personales: puedes dejar de compartirla (solo la cuenta de servicio necesita acceso).

---

## 11. Plan de reversión

- **Antes del paso 10.3:** revierte el despliegue en Vercel (*Deployments → Promote* del anterior). Google sigue activo y todo vuelve a como estaba.
- **Después del paso 10.3:** vuelve a activar el proveedor Google en Supabase, restaura el cliente OAuth y sus variables, y despliega la versión anterior.
- Los datos no se tocan en ningún paso: no hay migraciones SQL en esta guía.

---

## 12. Preguntas frecuentes

**¿Y si un usuario no recibe el código?** Revisa *Authentication → Logs* en Supabase y los registros del proveedor SMTP. Casi siempre es spam o el límite de envíos por hora.

**¿Puedo usar contraseña en vez de código?** Sí: `signInWithPassword`. Es un paso menos al entrar, pero hay que gestionar contraseñas olvidadas. Para un grupo privado pequeño el código es más cómodo y seguro.

**¿Se nota en velocidad?** El inicio de sesión pasa de 5–7 saltos entre dominios con pantalla de consentimiento a 2 pantallas propias. La reproducción no empeora: el service worker sigue leyendo Drive directamente, y el token del servidor se reutiliza 55 minutos en memoria.

**¿Cuotas de Drive?** Todas las lecturas pasan a hacerse con una sola identidad (la cuenta de servicio). Con 6 usuarios y segmentos de 4–6 s son unas pocas peticiones por segundo como máximo, muy por debajo de las cuotas por defecto de la Drive API. Vigila *APIs & Services → Drive API → Quotas* la primera semana.

**Tiempo estimado:** 2–3 horas (configuración 45 min, código 1–1,5 h, pruebas 30 min).
