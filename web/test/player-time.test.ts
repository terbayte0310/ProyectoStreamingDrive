import test from "node:test";
import assert from "node:assert/strict";
import { clampPlaybackTime, formatPlayerTime } from "../src/lib/media/player-time.ts";
test("player time supports long movies and unknown metadata", () => {
  assert.equal(formatPlayerTime(7325), "2:02:05");
  assert.equal(formatPlayerTime(65.9), "1:05");
  for (const value of [NaN, Infinity, -10]) assert.equal(formatPlayerTime(value), "0:00");
});
test("seeking never escapes the playable duration", () => {
  assert.equal(clampPlaybackTime(-10, 100), 0);
  assert.equal(clampPlaybackTime(200, 100), 100);
  assert.equal(clampPlaybackTime(45, 100), 45);
  assert.equal(clampPlaybackTime(10, Infinity), 0);
});
