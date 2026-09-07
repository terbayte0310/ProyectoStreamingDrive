import "server-only";

import type { NextResponse } from "next/server";

import { getDriveConfig } from "@/lib/drive/config";

export const DRIVE_ACCESS_COOKIE = "drive_provider_token";
export const DRIVE_REFRESH_COOKIE = "drive_provider_refresh_token";
export const DRIVE_USER_COOKIE = "drive_provider_user_id";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
};

export class DriveTokenError extends Error {
  constructor(
    public readonly code: string,
    public readonly description: string | null,
  ) {
    super("Google rechazó el intercambio de credenciales de Drive.");
    this.name = "DriveTokenError";
  }
}

async function requestGoogleToken(parameters: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: parameters,
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const token = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !token.access_token) {
    throw new DriveTokenError(token.error ?? "unknown", token.error_description?.slice(0, 300) ?? null);
  }
  return token;
}

export async function refreshDriveAccessToken(refreshToken: string) {
  const config = getDriveConfig();
  return requestGoogleToken(new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export function setDriveSessionCookies(response: NextResponse, token: GoogleTokenResponse, userId: string) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(DRIVE_ACCESS_COOKIE, token.access_token!, {
    httpOnly: true,
    maxAge: Math.max(60, (token.expires_in ?? 3600) - 300),
    path: "/api/drive-token",
    sameSite: "lax",
    secure,
  });
  if (token.refresh_token) {
    response.cookies.set(DRIVE_REFRESH_COOKIE, token.refresh_token, {
      httpOnly: true,
      maxAge: 180 * 24 * 60 * 60,
      path: "/api/drive-token",
      sameSite: "lax",
      secure,
    });
  }
  response.cookies.set(DRIVE_USER_COOKIE, userId, {
    httpOnly: true,
    maxAge: 180 * 24 * 60 * 60,
    path: "/api/drive-token",
    sameSite: "lax",
    secure,
  });
}

export function clearDriveSessionCookies(response: NextResponse) {
  response.cookies.set(DRIVE_ACCESS_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/api/drive-token" });
  response.cookies.set(DRIVE_REFRESH_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/api/drive-token" });
  response.cookies.set(DRIVE_USER_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/api/drive-token" });
}
