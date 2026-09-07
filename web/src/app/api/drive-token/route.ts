import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const token = request.cookies.get("drive_provider_token")?.value;
  if (!data.user || !token) return NextResponse.json({ error: "Drive authorization is missing." }, { status: 401 });

  return NextResponse.json(
    { accessToken: token },
    { headers: { "cache-control": "no-store" } },
  );
}
