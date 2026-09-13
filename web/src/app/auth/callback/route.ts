import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { setDriveSessionCookies } from "@/lib/drive/session";
import { getRequestOrigin } from "@/lib/http/request-origin";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const requestOrigin = getRequestOrigin(request);
  const code = requestUrl.searchParams.get("code");
  const flowId = requestUrl.searchParams.get("sb_flow_id");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!code || !url || !publishableKey) {
    return NextResponse.redirect(new URL("/signin?error=oauth_callback", requestOrigin));
  }

  const response = NextResponse.redirect(new URL("/catalog", requestOrigin));
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
  if (error) {
    const failed = NextResponse.redirect(new URL("/signin?error=oauth_callback", requestOrigin));
    failed.headers.set("Cache-Control", "private, no-store");
    return failed;
  }

  const user = data.user;
  const { data: profile } = user
    ? await supabase
      .from("profiles")
      .select("is_authorized")
      .eq("id", user.id)
      .maybeSingle<{ is_authorized: boolean }>()
    : { data: null };

  if (!profile?.is_authorized) {
    response.headers.set("Location", new URL("/dashboard", requestOrigin).toString());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const providerToken = data.session?.provider_token;
  const providerRefreshToken = data.session?.provider_refresh_token;
  if (!user || !providerToken || !providerRefreshToken) {
    response.headers.set("Location", new URL("/signin?error=drive_authorization", requestOrigin).toString());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  setDriveSessionCookies(response, {
    access_token: providerToken,
    expires_in: 3600,
    refresh_token: providerRefreshToken,
  }, user.id);
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}
