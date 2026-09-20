import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rewriteHlsPlaylistForDirect } from "../src/lib/media/hls.ts";
import { isFinished, resumePoint } from "../src/lib/media/local-progress.ts";

const packageId = "7c72ac21-3ea0-44ee-a68f-aadf5263f78c";
const segmentRoute = readFileSync(new URL("../src/app/api/media-hls/packages/[packageId]/[...path]/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("direct delivery sends segments to the worker and keeps playlists and subtitles on the server", () => {
  const master = rewriteHlsPlaylistForDirect(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/es/index.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitles/es.vtt"\nvideo/index.m3u8',
    "master.m3u8",
    [],
    packageId,
    "movies",
  );
  assert.ok(master.includes(`/api/drive-token/media-playback/packages/${packageId}/audio/es/index.m3u8?delivery=direct&m=movies`), master);
  assert.ok(master.includes(`/api/drive-token/media-playback/packages/${packageId}/video/index.m3u8?delivery=direct&m=movies`), master);
  assert.match(master, /subtitles\/es\.vtt\?hls-subtitle-playlist=1/);

  const media = rewriteHlsPlaylistForDirect(
    "#EXTM3U\n#EXTINF:6.0,\nsegment_00000.ts\n#EXTINF:6.0,\nsegment_00001.ts",
    "video/index.m3u8",
    [{ asset_kind: "segment", drive_file_id: "drive-abc", relative_path: "video/segment_00000.ts" }],
    packageId,
    "series",
  );
  assert.match(media, /\/drive-hls\/drive-abc\?m=series&p=video%2Fsegment_00000\.ts&pkg=/);
  // Un segmento sin fila en el índice vuelve al proxy del servidor en lugar de romperse.
  assert.ok(media.includes(`/api/drive-token/media-playback/packages/${packageId}/video/segment_00001.ts`), media);
});

test("segment responses are cacheable and identity is checked locally", () => {
  assert.match(segmentRoute, /immutable/);
  assert.match(segmentRoute, /getSessionUserId/);
  assert.doesNotMatch(segmentRoute, /getCurrentAccess/);
  assert.match(segmentRoute, /\.range\(page \* 1000/);
});

test("the worker falls back to the server proxy and reserves in parallel only when warm", () => {
  assert.match(worker, /\/drive-hls\//);
  assert.match(worker, /proxyFallback/);
  assert.match(worker, /budgetWarmUntil/);
});

test("local media progress resumes a little earlier and ignores finished titles", () => {
  assert.equal(resumePoint({ at: 1, d: 3600, t: 600 }), 597);
  assert.equal(resumePoint({ at: 1, d: 3600, t: 10 }), 0);
  assert.equal(isFinished({ at: 1, d: 3600, t: 3550 }), true);
  assert.equal(resumePoint({ at: 1, d: 3600, t: 3550 }), 0);
  assert.equal(resumePoint(null), 0);
});
