import { NextRequest, NextResponse } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/proxy";

// Google calls the stable, registered diagnostic URI. Internally it reaches the
// one-time AWS catalog importer; the external OAuth configuration stays stable.
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/drive/diagnostic/callback") {
    const destination = new URL("/api/drive/diagnostic-import/callback", request.url);
    destination.search = request.nextUrl.search;
    return NextResponse.rewrite(destination);
  }
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
