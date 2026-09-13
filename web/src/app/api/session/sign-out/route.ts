import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

import { clearDriveSessionCookies } from "@/lib/drive/session";

export const dynamic = "force-dynamic";

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  }

  const response = NextResponse.json(
    { signedOut: true },
    { headers: { "cache-control": "no-store" } },
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let cleanupWarning = !url || !publishableKey;

  if (url && publishableKey) {
    const supabase = createServerClient(url, publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, options, value }) => response.cookies.set(name, value, options));
        },
      },
    });
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      cleanupWarning = Boolean(error);
    } catch {
      cleanupWarning = true;
    }
  }

  clearDriveSessionCookies(response);
  response.headers.set("x-session-cleanup-warning", cleanupWarning ? "1" : "0");
  return response;
}
