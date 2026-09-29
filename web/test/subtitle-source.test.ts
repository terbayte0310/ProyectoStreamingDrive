import assert from "node:assert/strict";
import test from "node:test";
import { loadSubtitleSource } from "../src/lib/media/subtitle-source.ts";

const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHola\n";

test("loads the VTT referenced by a generated HLS subtitle playlist", async () => {
  const requests: string[] = [];
  const fetcher = (async (input: URL | RequestInfo) => {
    requests.push(String(input));
    return new Response(requests.length === 1 ? "#EXTM3U\n#EXTINF:7200,\nsubtitle.vtt\n#EXT-X-ENDLIST\n" : vtt);
  }) as typeof fetch;
  assert.equal(await loadSubtitleSource("https://example.test/subtitles/es/index.m3u8", fetcher), vtt);
  assert.deepEqual(requests, ["https://example.test/subtitles/es/index.m3u8", "https://example.test/subtitles/es/subtitle.vtt"]);
});

test("loads legacy standalone VTT without its synthetic playlist flag", async () => {
  const fetcher = (async (input: URL | RequestInfo) => {
    assert.equal(String(input), "https://example.test/es.vtt?token=keep");
    return new Response(vtt);
  }) as typeof fetch;
  assert.equal(await loadSubtitleSource("https://example.test/es.vtt?hls-subtitle-playlist=1&token=keep", fetcher), vtt);
});

test("rejects invalid subtitle content and failed downloads", async () => {
  await assert.rejects(loadSubtitleSource("https://example.test/es.vtt", (async () => new Response("invalid")) as typeof fetch), /WebVTT/);
  await assert.rejects(loadSubtitleSource("https://example.test/es.vtt", (async () => new Response(null, { status: 401 })) as typeof fetch), /HTTP 401/);
});
