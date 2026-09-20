import { AppHeader } from "@/components/app-header";
import { getViewer } from "@/lib/auth/access";

/** Cabecera de servidor: reutiliza el viewer memorizado de la petición. */
export async function SiteHeader({ tone = "default" }: { tone?: "default" | "media" }) {
  const viewer = await getViewer();
  return (
    <AppHeader
      admin={viewer?.profile?.role === "admin" && viewer.profile.is_authorized}
      email={viewer?.profile?.email}
      modules={viewer?.profile?.is_authorized ? viewer.modules : []}
      tone={tone}
    />
  );
}
