import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type FetchCall = { headers?: Headers; url: string };

function createWorkerHarness(tokenResponseStatus: number, token = "fresh-token") {
  const listeners = new Map<string, (event: never) => void>();
  const fetchCalls: FetchCall[] = [];
  const self = {
    addEventListener(type: string, listener: (event: never) => void) {
      listeners.set(type, listener);
    },
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const fetch = async (input: string, init?: { headers?: Headers }) => {
    fetchCalls.push({ headers: init?.headers, url: input });
    if (input === "/api/drive-token?force=1") {
      return tokenResponseStatus === 200
        ? new Response(JSON.stringify({ accessToken: token }), { status: 200 })
        : new Response(null, { status: tokenResponseStatus });
    }
    return new Response("media", { status: 206 });
  };
  const context = vm.createContext({ Headers, Promise, Response, URL, encodeURIComponent, fetch, self });
  const script = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  vm.runInContext(script, context);

  function message(data: unknown) {
    const replies: unknown[] = [];
    listeners.get("message")?.({ data, ports: [{ postMessage: (value: unknown) => replies.push(value) }] } as never);
    return replies;
  }

  async function stream() {
    let responsePromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: { headers: new Headers(), url: "https://nebula.test/drive-stream/file" },
      respondWith(value: Promise<Response>) {
        responsePromise = value;
      },
    } as never);
    return responsePromise;
  }

  return { fetchCalls, message, stream };
}

test("clearing the service worker token blocks stale tokens from serving a new stream", async () => {
  const worker = createWorkerHarness(401);

  worker.message({ token: "stale-token", type: "drive-access-token" });
  const clearReplies = worker.message({ type: "clear-drive-access-token" });
  assert.equal((clearReplies[0] as { cleared?: boolean }).cleared, true);

  worker.message({ token: "late-stale-token", type: "drive-access-token" });
  await new Promise((resolve) => setImmediate(resolve));
  const response = await worker.stream();

  assert.equal(response?.status, 401);
  assert.deepEqual(worker.fetchCalls.map((call) => call.url), ["/api/drive-token?force=1", "/api/drive-token?force=1"]);
});

test("a fresh server-issued token can reopen the worker after a new authorization", async () => {
  const worker = createWorkerHarness(200, "new-token");

  worker.message({ token: "stale-token", type: "drive-access-token" });
  worker.message({ type: "clear-drive-access-token" });
  const replies = worker.message({ token: "post-login-token", type: "drive-access-token" });
  await new Promise((resolve) => setImmediate(resolve));
  const response = await worker.stream();

  assert.equal((replies[0] as { accepted?: boolean }).accepted, true);
  assert.equal(response?.status, 206);
  assert.equal(worker.fetchCalls.at(-1)?.headers?.get("Authorization"), "Bearer new-token");
});
