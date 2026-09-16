import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { clearDriveSessionCookies, setDriveSessionCookies } from "@/lib/drive/session";
import { getRequestOrigin } from "@/lib/http/request-origin";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/catalog";
}

function returnWithDriveError(origin: string, returnTo: string, error: string) {
  const destination = new URL(returnTo, origin);
  destination.searchParams.set("drive", error);
  return NextResponse.redirect(destination);
}

export async function GET(request: NextRequest) {
  const requestOrigin = getRequestOrigin(request);
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!code || !url || !publishableKey) return returnWithDriveError(requestOrigin, returnTo, "missing-code");

  const response = NextResponse.redirect(new URL(returnTo, requestOrigin));
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headersToSet) {
        for (const { name, options, value } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headersToSet)) response.headers.set(name, value);
      },
    },
  });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error || !data.user || !data.session?.provider_token) return returnWithDriveError(requestOrigin, returnTo, "exchange-error");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_authorized")
    .eq("id", data.user.id)
    .maybeSingle<{ is_authorized: boolean }>();
  if (!profile?.is_authorized) {
    clearDriveSessionCookies(response);
    response.headers.set("Location", new URL("/dashboard", requestOrigin).toString());
    return response;
  }

  if (!data.session.provider_refresh_token) return returnWithDriveError(requestOrigin, returnTo, "missing-refresh-token");
  setDriveSessionCookies(response, {
    access_token: data.session.provider_token,
    expires_in: 3600,
    refresh_token: data.session.provider_refresh_token,
  }, data.user.id);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}