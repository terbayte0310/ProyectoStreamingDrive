import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedAdmin } from "@/lib/drive/authorization";
import { getDriveConfig } from "@/lib/drive/config";

// Reuses the already registered pilot callback. This route intentionally does not
// request incremental scopes, keeping the authorization request identical to the
// diagnostic flow that successfully exchanged a code.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireAuthorizedAdmin())) return NextResponse.redirect(new URL("/signin", request.url));

  try {
    const config = getDriveConfig();
    const state = crypto.randomUUID();
    const callback = new URL("/api/drive/pilot/callback", request.url).toString();
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      access_type: "online",
      client_id: config.clientId,
      prompt: "consent",
      redirect_uri: callback,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
      state,
    }).toString();

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set("drive_pilot_state", state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/api/drive/pilot",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/drive-pilot?error=configuracion", request.url));
  }
}
