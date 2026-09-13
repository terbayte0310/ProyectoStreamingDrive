import { NextRequest, NextResponse } from "next/server";

import { setDriveSessionCookies } from "@/lib/drive/session";
import { getRequestOrigin } from "@/lib/http/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/catalog";
}

export async function GET(request: NextRequest) {
  const requestOrigin = getRequestOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  if (!code) return NextResponse.redirect(new URL("/drive-access?error=missing-code", requestOrigin));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error || !data.user || !data.session?.provider_token) {
    const destination = new URL("/drive-access", requestOrigin);
    destination.searchParams.set("error", "supabase-exchange");
    if (error?.message) destination.searchParams.set("detail", error.message.slice(0, 300));
    return NextResponse.redirect(destination);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_authorized")
    .eq("id", data.user.id)
    .maybeSingle<{ is_authorized: boolean }>();
  if (!profile?.is_authorized) return NextResponse.redirect(new URL("/dashboard", requestOrigin));
  if (!data.session.provider_refresh_token) {
    return NextResponse.redirect(new URL("/drive-access?error=refresh-token", requestOrigin));
  }

  const response = NextResponse.redirect(new URL(returnTo, requestOrigin));
  setDriveSessionCookies(response, {
    access_token: data.session.provider_token,
    expires_in: 3600,
    refresh_token: data.session.provider_refresh_token,
  }, data.user.id);
  return response;
}
