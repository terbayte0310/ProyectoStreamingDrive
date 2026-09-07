import { NextRequest, NextResponse } from "next/server";

import { requireAuthorizedAdmin } from "@/lib/drive/authorization";
import { getDriveConfig } from "@/lib/drive/config";

type DriveFile = {
  id: string;
  mimeType: string;
  modifiedTime?: string;
  name: string;
  size?: string;
};

type TokenResponse = {
  access_token?: string;
};

type FilesResponse = {
  files?: DriveFile[];
};

function redirectToPilot(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/drive-pilot?status=${status}`, request.url));
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireAuthorizedAdmin();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url));

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get("drive_pilot_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToPilot(request, "estado-invalido");
  }

  try {
    const config = getDriveConfig();
    const redirectUri = new URL("/api/drive/pilot/callback", request.url).toString();
    const tokenBody = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      body: tokenBody,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const token = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !token.access_token) return redirectToPilot(request, "token-invalido");

    const query = new URLSearchParams({
      fields: "files(id,name,mimeType,modifiedTime,size)",
      orderBy: "folder,name_natural",
      pageSize: "100",
      q: `'${config.rootFolderId}' in parents and trashed = false`,
    });
    const filesResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const result = (await filesResponse.json()) as FilesResponse;
    if (!filesResponse.ok) return redirectToPilot(request, "lectura-fallida");

    const response = NextResponse.json({
      folderId: config.rootFolderId,
      items: result.files ?? [],
      message: "Lectura temporal completada. No se guardó ningún token ni se modificó Drive.",
    });
    response.cookies.delete("drive_pilot_state");
    return response;
  } catch {
    return redirectToPilot(request, "error-inesperado");
  }
}
