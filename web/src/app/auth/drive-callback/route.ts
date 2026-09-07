import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/drive-access?error=missing-code", request.url));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session?.provider_token) {
    return NextResponse.redirect(new URL("/drive-access?error=token-not-received", request.url));
  }

  const response = NextResponse.redirect(new URL("/drive-sw-test", request.url));
  response.cookies.set("drive_provider_token", data.session.provider_token, {
    httpOnly: true,
    maxAge: 50 * 60,
    path: "/api/drive-token",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
