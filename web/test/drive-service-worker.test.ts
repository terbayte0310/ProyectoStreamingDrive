import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type FetchCall = { body?: string; headers?: Headers; url: string };

function createWorkerHarness(
  tokenResponseStatus: number,
  token = "fresh-token",
  budgetResponse = { allowed: true, globalWarning: false, reservationId: "00000000-0000-4000-8000-000000000001", userWarning: false },
) {
  const listeners = new Map<string, (event: never) => void>();
  const fetchCalls: FetchCall[] = [];
  const self = {
    addEventListener(type: string, listener: (event: never) => void) {
      listeners.set(type, listener);
    },
    clients: { claim: async () => undefined, matchAll: async () => [] },
    skipWaiting: () => undefined,
  };
  const fetch = async (input: string, init?: { body?: string; headers?: Headers }) => {
    fetchCalls.push({ body: init?.body, headers: init?.headers, url: input });
    if (input === "/api/drive-token?force=1") {
      return tokenResponseStatus === 200
        ? new Response(JSON.stringify({ accessToken: token }), { status: 200 })
        : new Response(null, { status: tokenResponseStatus });
    }
    if (input === "/api/transfer-budget") {
      const operation = JSON.parse(init?.body ?? "{}") as { operation?: string };
      if (operation.operation === "reserve") {
        const allowed = budgetResponse.allowed;
        return new Response(JSON.stringify(allowed ? budgetResponse : {
          code: "emergency_fuse",
          error: "El fusible global de transferencia está activo.",
        }), { status: allowed ? 201 : 429 });
      }
      return new Response(JSON.stringify({ completed: true }), { status: 200 });
    }
    return new Response("media", { status: 206 });
  };
  const context = vm.createContext({ Date, Headers, Math, Promise, Response, URL, clearTimeout, encodeURIComponent, fetch, self, setTimeout });
  const script = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  vm.runInContext(script, context);

  function message(data: unknown) {
    const replies: unknown[] = [];
    listeners.get("message")?.({ data, ports: [{ postMessage: (value: unknown) => replies.push(value) }] } as never);
    return replies;
  }

  async function stream() {
    let responsePromise: Promise<Response> | undefined;
    const background: Promise<unknown>[] = [];
    listeners.get("fetch")?.({
      request: { headers: new Headers(), url: "https://nebula.test/drive-stream/file" },
      respondWith(value: Promise<Response>) {
        responsePromise = value;
      },
      waitUntil(value: Promise<unknown>) {
        background.push(value);
      },
    } as never);
    const response = await responsePromise;
    await Promise.all(background);
    return response;
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
  assert.deepEqual(
    worker.fetchCalls.filter((call) => call.url.includes("drive-token")).map((call) => call.url),
    ["/api/drive-token?force=1", "/api/drive-token?force=1"],
  );
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
  const driveCall = worker.fetchCalls.find((call) => call.url.startsWith("https://www.googleapis.com/drive/"));
  assert.equal(driveCall?.headers?.get("Authorization"), "Bearer new-token");
});

test("reserves before Drive and confirms an accepted range", async () => {
  const worker = createWorkerHarness(200);
  worker.message({ token: "active-token", type: "drive-access-token" });

  const response = await worker.stream();
  const operations = worker.fetchCalls
    .filter((call) => call.url === "/api/transfer-budget")
    .map((call) => JSON.parse(call.body ?? "{}").operation);
  const reserveIndex = worker.fetchCalls.findIndex((call) => call.url === "/api/transfer-budget");
  const driveIndex = worker.fetchCalls.findIndex((call) => call.url.startsWith("https://www.googleapis.com/drive/"));

  assert.equal(response?.status, 206);
  assert.ok(reserveIndex >= 0 && reserveIndex < driveIndex);
  assert.deepEqual(operations, ["reserve", "confirm"]);
});

test("the emergency fuse blocks a new request before Drive", async () => {
  const worker = createWorkerHarness(200, "fresh-token", {
    allowed: false,
    globalWarning: true,
    reservationId: "",
    userWarning: true,
  });
  worker.message({ token: "active-token", type: "drive-access-token" });

  const response = await worker.stream();

  assert.equal(response?.status, 429);
  assert.equal(worker.fetchCalls.some((call) => call.url.startsWith("https://www.googleapis.com/drive/")), false);
});
