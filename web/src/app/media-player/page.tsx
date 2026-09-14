import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { MediaHlsPlayer } from "@/components/media-hls-player";
import { requireAuthorizedAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MediaPlayerPage({ searchParams }: { searchParams: Promise<{ package?: string }> }) {
  const { package: packageId } = await searchParams;
  if (!packageId) notFound();
  const access = await requireAuthorizedAccess();
  const supabase = await createSupabaseServerClient();
  const { data: packageRow } = await supabase.from("media_hls_packages").select("id, movie_id, episode_id").eq("id", packageId).maybeSingle<{ episode_id: string | null; id: string; movie_id: string | null }>();
  if (!packageRow) notFound();
  const isMovie = Boolean(packageRow.movie_id);
  const { data: content } = isMovie
    ? await supabase.from("movies").select("admin_title").eq("id", packageRow.movie_id!).maybeSingle<{ admin_title: string }>()
    : await supabase.from("series_episodes").select("admin_title").eq("id", packageRow.episode_id!).maybeSingle<{ admin_title: string }>();
  if (!content) notFound();
  const mediaModule = isMovie ? "movies" : "series";
  const backUrl = isMovie ? `/catalog/movies/${packageRow.movie_id}` : "/catalog/series";
  return <div className="app-shell player-page"><AppHeader admin={access.profile.role === "admin"} contextLabel="Reproductor" email={access.profile.email} showNavigation={false} /><main className="player-layout"><section className="player-stage"><div className="player-titlebar"><div><p className="eyebrow">{isMovie ? "Película" : "Episodio"}</p><h1>{content.admin_title}</h1></div><Link className="secondary-button" href={backUrl}>Volver al catálogo</Link></div><MediaHlsPlayer module={mediaModule} packageId={packageRow.id} /></section></main></div>;
}
