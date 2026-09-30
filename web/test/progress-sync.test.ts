import assert from "node:assert/strict";
import test from "node:test";
import { cacheProgress, readLocalProgress } from "../src/lib/media/local-progress.ts";
import { createProgressSync, loadMediaProgress } from "../src/lib/media/progress-sync.ts";

test("progress synchronization", async (suite) => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalNow = Date.now;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
  try {
    await suite.test("isolates accounts and adopts legacy checkpoints only once", () => {
      storage.set("nb-progress:legacy", JSON.stringify({ at: 10, t: 15, d: 100 }));
      assert.equal(readLocalProgress("legacy", "a")?.t, 15);
      assert.equal(readLocalProgress("legacy", "b"), null);
      cacheProgress("movie", { at: 20, t: 30, d: 100 }, "a");
      assert.equal(readLocalProgress("movie", "b"), null);
    });
    await suite.test("deduplicates batch reads and picks the most recent checkpoint", async () => {
      let calls = 0;
      cacheProgress("one", { at: 3000, t: 40, d: 100 }, "a");
      globalThis.fetch = (async () => {
        calls += 1;
        return Response.json({ progress: [
          { package_id: "one", watched_at: new Date(2000).toISOString(), position_seconds: 20, duration_seconds: 100 },
          { package_id: "two", watched_at: new Date(4000).toISOString(), position_seconds: 50, duration_seconds: 100 },
        ] });
      }) as typeof fetch;
      const [a, b] = await Promise.all([loadMediaProgress(["one", "two"], "a"), loadMediaProgress(["two", "one"], "a")]);
      assert.equal(calls, 1);
      assert.equal(a, b);
      assert.equal(a.get("one")?.t, 40);
      assert.equal(readLocalProgress("two", "a")?.t, 50);
    });
    await suite.test("throttles periodic writes, skips duplicates and retries failures", async () => {
      let now = 100_000;
      Date.now = () => now;
      let calls = 0;
      globalThis.fetch = (async () => { calls += 1; return new Response(null, { status: calls === 1 ? 503 : 200 }); }) as typeof fetch;
      const sync = createProgressSync("movie", "a");
      const checkpoint = { at: now, d: 1000, t: 30 };
      await sync(checkpoint);
      now += 5000;
      await sync(checkpoint);
      assert.equal(calls, 1);
      now += 25000;
      await sync(checkpoint);
      assert.equal(calls, 2);
      await sync(checkpoint, true);
      assert.equal(calls, 2);
      await sync({ ...checkpoint, at: now, t: 40 }, true);
      assert.equal(calls, 3);
    });
    await suite.test("queues the final checkpoint while a request is in flight", async () => {
      const positions: number[] = [];
      let resolve!: (response: Response) => void;
      globalThis.fetch = (async (_url, options) => {
        positions.push(JSON.parse(String(options?.body)).t);
        return positions.length === 1 ? new Promise<Response>((done) => { resolve = done; }) : new Response();
      }) as typeof fetch;
      const sync = createProgressSync("movie", "a");
      const first = sync({ at: 100, t: 30, d: 100 }, true);
      await sync({ at: 200, t: 45, d: 100 }, true);
      resolve(new Response());
      await first;
      assert.deepEqual(positions, [30, 45]);
    });
    await suite.test("offline reads retain the local checkpoint", async () => {
      globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
      const result = await loadMediaProgress(["movie"], "a");
      assert.equal(result.get("movie")?.t, 30);
    });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
