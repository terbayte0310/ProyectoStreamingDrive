import assert from "node:assert/strict";
import test from "node:test";

import { buildGoogleSignInOptions, GOOGLE_DRIVE_READONLY_SCOPE } from "../src/lib/auth/google-oauth.ts";

test("requests renewable read-only Drive access during the initial Google sign in", () => {
  assert.deepEqual(buildGoogleSignInOptions("http://192.168.18.17:3000"), {
    redirectTo: "http://192.168.18.17:3000/auth/callback",
    scopes: GOOGLE_DRIVE_READONLY_SCOPE,
    queryParams: {
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
    },
  });
});
