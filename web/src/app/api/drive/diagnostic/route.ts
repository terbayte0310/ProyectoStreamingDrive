import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedAdmin } from "@/lib/drive/authorization";
import { getDriveConfig } from "@/lib/drive/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireAuthorizedAdmin())) return NextResponse.redirect(new URL("/signin", request.url));

  try {
    const config = getDriveConfig();
    const state = crypto.randomUUID();
    const redirectUri = new URL("/api/drive/diagnostic/callback", request.url).toString();
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      access_type: "online",
      client_id: config.clientId,
      prompt: "consent",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
      state,
    }).toString();

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set("drive_diagnostic_state", state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/api/drive/diagnostic",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch {
    return NextResponse.json({ outcome: "configuration_missing" }, { status: 500 });
  }
}
