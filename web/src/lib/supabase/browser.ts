import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates the browser-side Supabase client.
 * Only public project values belong in NEXT_PUBLIC_ variables.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase public configuration. Create web/.env.local from .env.local.example.",
    );
  }

  return createBrowserClient(url, publishableKey);
}
