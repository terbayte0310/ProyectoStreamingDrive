import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AccessProfile = { email: string; is_authorized: boolean; role: "admin" | "reader" };
export type LibraryModule = "courses" | "movies" | "series";
export type Viewer = { modules: LibraryModule[]; modulesError: boolean; profile: AccessProfile | null; user: { id: string } };

const libraryModules: readonly LibraryModule[] = ["courses", "movies", "series"];

export function parseModules(rows: unknown): LibraryModule[] {
  if (!Array.isArray(rows)) return [];
  const found = new Set<LibraryModule>();
  for (const row of rows) {
    const value = row && typeof row === "object" ? (row as { module?: unknown }).module : undefined;
    if (typeof value === "string" && (libraryModules as readonly string[]).includes(value)) found.add(value as LibraryModule);
  }
  return libraryModules.filter((module) => found.has(module));
}

/**
 * Identidad sin viajes de red: getClaims valida el JWT localmente con claves
 * asimétricas. Úsalo en rutas calientes (segmentos, tokens) donde las
 * políticas RLS ya deciden qué filas son visibles.
 */
export async function getSessionUserId() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  return error || !userId ? null : userId;
}

/** Sesión + perfil. Pensado para rutas de API de administración. */
export async function getCurrentAccess() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (claimsError || !userId) return null;
  const { data: profile } = await supabase.from("profiles").select("email, role, is_authorized").eq("id", userId).maybeSingle<AccessProfile>();
  return { user: { id: userId }, profile };
}

/**
 * Sesión, perfil y módulos en una sola ronda paralela, memorizada durante el
 * render: la cabecera, la página y sus componentes comparten el resultado.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (claimsError || !userId) return null;
  const [profileResult, modulesResult] = await Promise.all([
    supabase.from("profiles").select("email, role, is_authorized").eq("id", userId).maybeSingle<AccessProfile>(),
    supabase.rpc("get_my_module_access"),
  ]);
  return {
    modules: parseModules(modulesResult.data),
    modulesError: Boolean(modulesResult.error),
    profile: profileResult.data ?? null,
    user: { id: userId },
  };
});

export type AuthorizedViewer = Viewer & { profile: AccessProfile };

export async function requireAuthorizedAccess(): Promise<AuthorizedViewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/signin");
  if (!viewer.profile?.is_authorized) redirect("/dashboard");
  return viewer as AuthorizedViewer;
}

export async function requireModuleAccess(module: LibraryModule) {
  const viewer = await requireAuthorizedAccess();
  if (!viewer.modules.includes(module)) redirect(`/catalog?access=${module}-denied`);
  return viewer;
}

export async function requireAdminAccess() {
  const viewer = await requireAuthorizedAccess();
  if (viewer.profile.role !== "admin") redirect("/catalog");
  return viewer;
}
