// The browser sends the existing HttpOnly Drive cookies on this scoped route.
// The delegated handlers keep their administrator and origin checks.
export { GET, POST } from "@/app/api/admin/media-playback/route";
export const dynamic = "force-dynamic";
