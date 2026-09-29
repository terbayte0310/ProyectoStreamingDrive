/** Resolve the single full-length WebVTT file used by our subtitle playlists. */
export async function loadSubtitleSource(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const source = new URL(url);
  // Legacy manifests wrap a standalone VTT in a synthetic HLS playlist.
  source.searchParams.delete("hls-subtitle-playlist");
  const response = await fetcher(source, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const body = text.replace(/^\uFEFF/, "").trimStart();
  if (body.startsWith("WEBVTT")) return text;
  if (body.startsWith("#EXTM3U")) {
    const files = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (files.length === 1) {
      const file = new URL(files[0], response.url || source.href);
      const vttResponse = await fetcher(file, { credentials: "same-origin" });
      if (!vttResponse.ok) throw new Error(`HTTP ${vttResponse.status}`);
      const vtt = await vttResponse.text();
      if (vtt.replace(/^\uFEFF/, "").trimStart().startsWith("WEBVTT")) return vtt;
    }
  }
  throw new Error("La pista de subtítulos no contiene un archivo WebVTT válido.");
}
