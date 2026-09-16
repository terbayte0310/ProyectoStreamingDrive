import "server-only";

export function readMonotonicTime() {
  return performance.now();
}
