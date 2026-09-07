import { NextRequest, NextResponse } from "next/server";

// Google calls the stable, registered diagnostic URI. Internally it reaches the
// one-time AWS catalog importer; the external OAuth configuration stays stable.
export function proxy(request: NextRequest) {
  const destination = new URL("/api/drive/diagnostic-import/callback", request.url);
  destination.search = request.nextUrl.search;
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: "/api/drive/diagnostic/callback",
};
