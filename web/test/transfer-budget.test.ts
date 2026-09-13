import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculateTransferBytes, TransferRangeError } from "../src/lib/transfer-budget.ts";

test("calculates bounded, open and suffix byte ranges", () => {
  assert.equal(calculateTransferBytes("stream", "bytes=0-1023", 10_000), 1024);
  assert.equal(calculateTransferBytes("stream", "bytes=9000-", 10_000), 1000);
  assert.equal(calculateTransferBytes("stream", "bytes=-500", 10_000), 500);
  assert.equal(calculateTransferBytes("stream", "bytes=9000-12000", 10_000), 1000);
});

test("counts a download or range-free stream conservatively as the full file", () => {
  assert.equal(calculateTransferBytes("download", "bytes=0-99", 10_000), 10_000);
  assert.equal(calculateTransferBytes("stream", null, 10_000), 10_000);
});

test("rejects invalid and multi-part ranges", () => {
  assert.throws(() => calculateTransferBytes("stream", "bytes=10000-", 10_000), TransferRangeError);
  assert.throws(() => calculateTransferBytes("stream", "bytes=0-1,4-5", 10_000), TransferRangeError);
});

test("migration keeps warnings soft and serializes the global emergency check", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260913010000_transfer_usage_protection.sql", import.meta.url), "utf8");
  assert.match(migration, /26843545600[\s\S]*161061273600[\s\S]*805306368000/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_global_used \+ p_request_bytes > v_settings\.global_emergency_bytes/);
  assert.doesNotMatch(migration, /drive_file_id|detected_title|ip_address/i);
});
