import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rewriteHlsPlaylistForPackage } from "../src/lib/media/hls.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260913060000_media_hls_playback.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260913060000_media_hls_playback.rollback.sql", import.meta.url), "utf8");
const playbackRoute = readFileSync(new URL("../src/app/api/admin/media-playback/route.ts", import.meta.url), "utf8");
const manifestRoute = readFileSync(new URL("../src/app/api/media-hls/packages/[packageId]/manifest/route.ts", import.meta.url), "utf8");
const packageAssetRoute = readFileSync(new URL("../src/app/api/media-hls/packages/[packageId]/[...path]/route.ts", import.meta.url), "utf8");
const scopedPackageAssetRoute = readFileSync(new URL("../src/app/api/drive-token/media-playback/packages/[packageId]/[...path]/route.ts", import.meta.url), "utf8");
const hlsUtilities = readFileSync(new URL("../src/lib/media/hls.ts", import.meta.url), "utf8");
const player = readFileSync(new URL("../src/components/media-hls-player.tsx", import.meta.url), "utf8");
const converter = readFileSync(new URL("../../scripts/convert_hls_package.ps1", import.meta.url), "utf8");

test("HLS playback ties a package to exactly one movie or episode", () => {
  assert.match(migration, /check \(\(movie_id is null\) <> \(episode_id is null\)\)/);
  assert.match(migration, /media_hls_packages_movie_id_key/);
  assert.match(migration, /media_hls_packages_episode_id_key/);
  assert.match(migration, /manifest_asset_id uuid/);
  assert.match(migration, /validate_media_hls_manifest_asset/);
});

test("HLS playback limits readers to a ready published parent and their module", () => {
  assert.match(migration, /Movie members read ready playback packages/);
  assert.match(migration, /Series members read ready playback packages/);
  assert.match(migration, /public\.has_module_access\('movies'\)/);
  assert.match(migration, /public\.has_module_access\('series'\)/);
  assert.match(migration, /movie\.status = 'published'/);
  assert.match(migration, /episode\.status = 'published'/);
  assert.match(migration, /is_active/);
});

test("HLS scanner keeps Drive data server-side and reverses cleanly", () => {
  assert.match(playbackRoute, /assertFolderInsideSource/);
  assert.match(playbackRoute, /scanHlsPackage/);
  assert.match(playbackRoute, /isSameOrigin/);
  assert.match(manifestRoute, /rewriteHlsPlaylist/);
  assert.match(rollback, /drop table if exists public\.media_hls_assets/);
  assert.match(rollback, /drop type if exists public\.media_hls_package_status/);
});

test("HLS physical assets use the Drive-cookie scope", () => {
  assert.match(hlsUtilities, /\/api\/drive-token\/media-playback\/packages\//);
  assert.match(scopedPackageAssetRoute, /api\/media-hls\/packages\/\[packageId\]\/\[\.\.\.path\]\/route/);
  assert.match(packageAssetRoute, /getDriveTokenForMedia/);
  assert.match(packageAssetRoute, /request\.nextUrl\.pathname\.startsWith\("\/api\/media-hls\/packages\/"\)/);
  assert.match(packageAssetRoute, /NextResponse\.redirect\(destination, 307\)/);
});

test("legacy absolute HLS URLs are canonicalized for audio, subtitles and segments", () => {
  const packageId = "7c72ac21-3ea0-44ee-a68f-aadf5263f78c";
  const assets = [
    { relative_path: "audio/es/index.m3u8" },
    { relative_path: "subtitles/es.vtt" },
    { relative_path: "video/index.m3u8" },
    { relative_path: "video/segment-00001.ts" },
  ];
  const master = rewriteHlsPlaylistForPackage(
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="/api/media-hls/packages/old-package/audio/es/index.m3u8"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,URI="/api/media-hls/packages/old-package/subtitles/es.vtt"',
      "video/index.m3u8",
    ].join("\n"),
    "master.m3u8",
    assets,
    packageId,
  );
  const base = `/api/drive-token/media-playback/packages/${packageId}`;
  assert.match(master, new RegExp(`${base}/audio/es/index\\.m3u8`));
  assert.match(master, new RegExp(`${base}/subtitles/es\\.vtt\\?hls-subtitle-playlist=1`));
  assert.match(master, new RegExp(`${base}/video/index\\.m3u8`));

  const media = rewriteHlsPlaylistForPackage(
    "#EXTM3U\n/api/media-hls/packages/old-package/video/segment-00001.ts",
    "video/index.m3u8",
    assets,
    packageId,
  );
  assert.match(media, new RegExp(`${base}/video/segment-00001\\.ts`));
});

test("every package-local URI is scoped even when its inventory spelling does not match", () => {
  const packageId = "7c72ac21-3ea0-44ee-a68f-aadf5263f78c";
  const rewritten = rewriteHlsPlaylistForPackage(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitles/es.vtt"',
    "master.m3u8",
    [],
    packageId,
  );
  assert.match(rewritten, /\/api\/drive-token\/media-playback\/packages\/7c72ac21-3ea0-44ee-a68f-aadf5263f78c\/subtitles\/es\.vtt/);
  assert.match(rewritten, /hls-subtitle-playlist=1/);
  assert.doesNotMatch(rewritten, /URI="subtitles\/es\.vtt"/);
});

test("standalone WebVTT is exposed through a synthetic HLS media playlist", () => {
  assert.match(packageAssetRoute, /asset\.asset_kind === "subtitle"/);
  assert.match(packageAssetRoute, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(packageAssetRoute, /hls-subtitle-file/);
});

test("future conversions generate subtitle playlists instead of linking WebVTT from the master", () => {
  assert.match(converter, /Join-Path 'subtitles' \$subtitle\.Language/);
  assert.match(converter, /Join-Path \$subtitleDirectory 'index\.m3u8'/);
  assert.match(converter, /URI=.*subtitles\/\$\(\$subtitle\.Language\)\/index\.m3u8/);
  assert.doesNotMatch(converter, /URI=.*subtitles\/\$\(\$subtitle\.Language\)\.vtt/);
});

test("the player refreshes Drive once before hls.js requests secondary assets", () => {
  assert.match(player, /api\/drive-token\?force=1&module=\$\{module\}/);
  assert.match(player, /manifest\?hls-route=drive-cookie-v3/);
  assert.ok(player.indexOf("api/drive-token?force=1") < player.indexOf("instance.loadSource"));
});
