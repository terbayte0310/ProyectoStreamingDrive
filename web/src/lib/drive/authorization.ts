import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireAuthorizedAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;

  if (userError || !user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_authorized")
    .eq("id", user.id)
    .maybeSingle<{ role: "admin" | "reader"; is_authorized: boolean }>();

  if (!profile?.is_authorized || profile.role !== "admin") {
    return null;
  }

  return user;
}
