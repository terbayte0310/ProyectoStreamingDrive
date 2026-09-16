"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const driveReadonlyScope = "https://www.googleapis.com/auth/drive.readonly";

export async function reconnectGoogleDrive(returnTo: string) {
  const callback = new URL("/auth/drive-callback", window.location.origin);
  callback.searchParams.set("returnTo", returnTo.startsWith("/") ? returnTo : "/catalog");
  const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
    provider: "google",
    options: {
      queryParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent" },
      redirectTo: callback.toString(),
      scopes: driveReadonlyScope,
    },
  });
  if (error) throw new Error("No se pudo iniciar la reconexión con Google Drive.");
}
