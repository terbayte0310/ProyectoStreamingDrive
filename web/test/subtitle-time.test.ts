import assert from "node:assert/strict";
import test from "node:test";

import { shiftSubtitleCues, type MutableSubtitleCue } from "../src/lib/media/subtitle-time.ts";

test("subtitle delay is reapplied from original cue times instead of accumulating", () => {
  const cue = { endTime: 5, startTime: 3 };
  const originals = new WeakMap<MutableSubtitleCue, { endTime: number; startTime: number }>();
  const tracks = [{ cues: [cue] }];

  shiftSubtitleCues(tracks, 2, originals);
  assert.deepEqual(cue, { endTime: 7, startTime: 5 });

  shiftSubtitleCues(tracks, -1, originals);
  assert.deepEqual(cue, { endTime: 4, startTime: 2 });
});

test("subtitle delay clamps cues at zero and preserves a positive duration", () => {
  const cue = { endTime: 0.2, startTime: 0.1 };
  shiftSubtitleCues(
    [{ cues: [cue] }],
    -5,
    new WeakMap<MutableSubtitleCue, { endTime: number; startTime: number }>(),
  );
  assert.equal(cue.startTime, 0);
  assert.equal(cue.endTime, 0.01);
});
