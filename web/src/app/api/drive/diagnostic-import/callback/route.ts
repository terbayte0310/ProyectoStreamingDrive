import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedAdmin } from "@/lib/drive/authorization";
import { getDriveConfig } from "@/lib/drive/config";
import { importAwsPilotCatalog } from "@/lib/drive/catalog-importer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type TokenResponse = { access_token?: string; error?: string };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireAuthorizedAdmin())) return NextResponse.redirect(new URL("/signin", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || state !== request.cookies.get("drive_diagnostic_state")?.value) {
    return NextResponse.json({ outcome: "state_invalid" }, { status: 400 });
  }

  try {
    const config = getDriveConfig();
    const registeredCallback = `${request.nextUrl.origin}/api/drive/diagnostic/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: registeredCallback,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const token = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !token.access_token) {
      return NextResponse.json({ outcome: "token_exchange_failed", googleError: token.error ?? null }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const summary = await importAwsPilotCatalog({
      accessToken: token.access_token,
      rootFolderId: config.rootFolderId,
      supabase,
    });
    const response = NextResponse.json({ outcome: "import_complete", summary });
    response.cookies.delete("drive_diagnostic_state");
    return response;
  } catch {
    return NextResponse.json({ outcome: "import_failed" }, { status: 500 });
  }
}
