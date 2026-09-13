import { NextRequest, NextResponse } from "next/server";

import { getCurrentAccess } from "@/lib/auth/access";
import { clearDriveSessionCookies, DRIVE_ACCESS_COOKIE, DRIVE_REFRESH_COOKIE, DRIVE_USER_COOKIE, refreshDriveAccessToken, setDriveSessionCookies } from "@/lib/drive/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await getCurrentAccess();
  if (!access) return NextResponse.json({ error: "Debes iniciar sesión." }, { status: 401 });
  if (!access.profile?.is_authorized) return NextResponse.json({ error: "Esta cuenta no está autorizada." }, { status: 403 });

  const supabase = await createSupabaseServerClient();
  const { data: hasCourses, error: accessError } = await supabase.rpc("has_module_access", { p_module: "courses" });
  if (accessError || !hasCourses) return NextResponse.json({ error: "No tienes acceso al módulo Cursos." }, { status: 403 });

  const driveUserId = request.cookies.get(DRIVE_USER_COOKIE)?.value;
  if (driveUserId !== access.user.id) {
    const response = NextResponse.json({ error: "Debes autorizar Google Drive con esta cuenta." }, { status: 401 });
    clearDriveSessionCookies(response);
    return response;
  }

  const forceRefresh = request.nextUrl.searchParams.get("force") === "1";
  const accessToken = request.cookies.get(DRIVE_ACCESS_COOKIE)?.value;
  if (accessToken && !forceRefresh) return NextResponse.json({ accessToken }, { headers: { "cache-control": "no-store" } });

  const refreshToken = request.cookies.get(DRIVE_REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ error: "Debes autorizar Google Drive." }, { status: 401 });

  try {
    const token = await refreshDriveAccessToken(refreshToken);
    const response = NextResponse.json({ accessToken: token.access_token }, { headers: { "cache-control": "no-store" } });
    setDriveSessionCookies(response, token, access.user.id);
    return response;
  } catch {
    const response = NextResponse.json({ error: "La autorización de Drive venció o fue revocada." }, { status: 401 });
    clearDriveSessionCookies(response);
    return response;
  }
}
