import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedAdmin } from "@/lib/drive/authorization";
import { getDriveConfig } from "@/lib/drive/config";

type GoogleError = { error?: string; error_description?: string; access_token?: string };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireAuthorizedAdmin())) return NextResponse.redirect(new URL("/signin", request.url));

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !state || state !== request.cookies.get("drive_diagnostic_state")?.value) {
    return NextResponse.json({ outcome: "state_invalid" }, { status: 400 });
  }

  try {
    const config = getDriveConfig();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: new URL("/api/drive/diagnostic/callback", request.url).toString(),
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const payload = (await tokenResponse.json()) as GoogleError;
    const response = NextResponse.json({
      outcome: tokenResponse.ok && payload.access_token ? "token_received" : "token_exchange_failed",
      googleError: payload.error ?? null,
      googleErrorDescription: payload.error_description ?? null,
    }, { status: tokenResponse.ok ? 200 : 400 });
    response.cookies.delete("drive_diagnostic_state");
    return response;
  } catch {
    return NextResponse.json({ outcome: "unexpected_server_error" }, { status: 500 });
  }
}
