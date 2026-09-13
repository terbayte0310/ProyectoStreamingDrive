import assert from "node:assert/strict";
import test from "node:test";

import { getRequestOrigin } from "../src/lib/http/request-origin.ts";

function request(host: string | null, origin = "http://0.0.0.0:3000") {
  return {
    headers: new Headers(host ? { host } : undefined),
    nextUrl: new URL(origin),
  };
}

test("uses the browser host for a local Next server bound to 0.0.0.0", () => {
  assert.equal(getRequestOrigin(request("localhost:3000"), "development"), "http://localhost:3000");
  assert.equal(getRequestOrigin(request("192.168.18.17:3000"), "development"), "http://192.168.18.17:3000");
});

test("preserves the LAN browser host when Next reports localhost internally", () => {
  assert.equal(
    getRequestOrigin(request("192.168.18.17:3000", "http://localhost:3000"), "development"),
    "http://192.168.18.17:3000",
  );
});

test("uses the browser host when the production server is bound to all interfaces", () => {
  assert.equal(
    getRequestOrigin(request("192.168.18.17:3000"), "production"),
    "http://192.168.18.17:3000",
  );
});

test("rejects untrusted development hosts and preserves the configured production origin", () => {
  assert.equal(getRequestOrigin(request("example.test:3000"), "development"), "http://0.0.0.0:3000");
  assert.equal(
    getRequestOrigin(request("example.test", "https://nebula.example"), "production"),
    "https://nebula.example",
  );
});
