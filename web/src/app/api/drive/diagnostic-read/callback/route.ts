import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedAdmin } from "@/lib/drive/authorization";
import { getDriveConfig } from "@/lib/drive/config";

type TokenResponse = { access_token?: string; error?: string; error_description?: string };
type DriveFile = { id: string; mimeType: string; modifiedTime?: string; name: string; size?: string };
type FilesResponse = { files?: DriveFile[]; error?: { code?: number; message?: string } };

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

    const query = new URLSearchParams({
      fields: "files(id,name,mimeType,modifiedTime,size)",
      orderBy: "folder,name_natural",
      pageSize: "100",
      q: `'${config.rootFolderId}' in parents and trashed = false`,
    });
    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const payload = (await driveResponse.json()) as FilesResponse;
    const response = NextResponse.json(
      driveResponse.ok
        ? { outcome: "read_complete", items: payload.files ?? [] }
        : { outcome: "drive_read_failed", driveErrorCode: payload.error?.code ?? null, driveErrorMessage: payload.error?.message ?? null },
      { status: driveResponse.ok ? 200 : 400 },
    );
    response.cookies.delete("drive_diagnostic_state");
    return response;
  } catch {
    return NextResponse.json({ outcome: "unexpected_server_error" }, { status: 500 });
  }
}
