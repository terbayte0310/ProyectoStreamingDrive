import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const flowId = requestUrl.searchParams.get("sb_flow_id");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!code || !url || !publishableKey) {
    return NextResponse.redirect(new URL("/signin?error=oauth_callback", requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL("/catalog", requestUrl.origin));
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headersToSet) {
        for (const { name, options, value } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headersToSet)) response.headers.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error) {
    const failed = NextResponse.redirect(new URL("/signin?error=oauth_callback", requestUrl.origin));
    failed.headers.set("Cache-Control", "private, no-store");
    return failed;
  }

  return response;
}
