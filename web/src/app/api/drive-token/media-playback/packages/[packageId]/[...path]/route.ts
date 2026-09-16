// HLS files live below /api/drive-token so the browser includes the existing
// path-scoped, HttpOnly Google Drive session cookies on every asset request.
export { GET } from "@/app/api/media-hls/packages/[packageId]/[...path]/route";

export const dynamic = "force-dynamic";
