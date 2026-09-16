import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSupabaseSession(request: NextRequest) {
  const startedAt = performance.now();
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return response;

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headersToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, options, value } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headersToSet)) response.headers.set(name, value);
      },
    },
  });

  const claimsResult = await supabase.auth.getClaims();
  const authDuration = performance.now() - startedAt;
  response.headers.append("server-timing", `supabase-auth;dur=${authDuration.toFixed(1)}`);
  if (request.headers.get("sec-fetch-dest") === "document") {
    console.info(
      `[startup-performance] proxy path=${request.nextUrl.pathname} auth_ms=${authDuration.toFixed(1)} alg=${claimsResult.data?.header.alg ?? "none"}`,
    );
  }
  return response;
}
