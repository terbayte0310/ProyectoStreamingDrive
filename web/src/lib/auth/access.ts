import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AccessProfile = { email: string; is_authorized: boolean; role: "admin" | "reader" };

export async function getCurrentAccess() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase.from("profiles").select("email, role, is_authorized").eq("id", userData.user.id).maybeSingle<AccessProfile>();
  return { user: userData.user, profile };
}

export async function requireAuthorizedAccess() {
  const access = await getCurrentAccess();
  if (!access) redirect("/signin");
  if (!access.profile?.is_authorized) redirect("/dashboard");
  return access as typeof access & { profile: AccessProfile };
}

export async function requireAdminAccess() {
  const access = await requireAuthorizedAccess();
  if (access.profile.role !== "admin") redirect("/catalog");
  return access;
}
