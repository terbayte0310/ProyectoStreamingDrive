export type MutableSubtitleCue = {
  endTime: number;
  startTime: number;
};

type OriginalCueTime = {
  endTime: number;
  startTime: number;
};

export function shiftSubtitleCues<T extends MutableSubtitleCue>(
  tracks: ArrayLike<{ cues: ArrayLike<T> | null }>,
  delaySeconds: number,
  originalTimes: WeakMap<T, OriginalCueTime>,
) {
  const delay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const cues = tracks[trackIndex]?.cues;
    if (!cues) continue;
    for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
      const cue = cues[cueIndex];
      if (!cue) continue;
      let original = originalTimes.get(cue);
      if (!original) {
        original = { endTime: cue.endTime, startTime: cue.startTime };
        originalTimes.set(cue, original);
      }
      const startTime = Math.max(0, original.startTime + delay);
      cue.startTime = startTime;
      cue.endTime = Math.max(startTime + 0.01, original.endTime + delay);
    }
  }
}
