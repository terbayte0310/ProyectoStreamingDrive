"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const workerUrl = "/sw.js?revision=logout-v2";
const channelName = "nebula-session";
const storageKey = "nebula-session-sign-out";

export function prepareDriveWorker() {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register(workerUrl, { scope: "/" }).catch(() => undefined);
}

export async function clearDriveWorkerToken() {
  if (!("serviceWorker" in navigator)) return;

  prepareDriveWorker();
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker) return;

  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(resolve, 1_000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    worker.postMessage({ type: "clear-drive-access-token" }, [channel.port2]);
  });
}

function announceSignOut() {
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type: "signed-out" });
    channel.close();
  } catch {
    // The storage event below remains available in older browsers.
  }
  try {
    localStorage.setItem(storageKey, String(Date.now()));
  } catch {
    // Private browsing can disable local storage; the local tab is still signed out.
  }
}

export function subscribeToSignOut(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey && event.newValue) listener();
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event) => {
      if (event.data?.type === "signed-out") listener();
    };
  } catch {
    // Storage events provide the compatibility path.
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

export async function completeSignOut() {
  let cleanupWarning = false;
  try {
    const response = await fetch("/api/session/sign-out", { method: "POST" });
    cleanupWarning = !response.ok || response.headers.get("x-session-cleanup-warning") === "1";
  } catch {
    cleanupWarning = true;
  } finally {
    try {
      await clearDriveWorkerToken();
    } catch {
      cleanupWarning = true;
    }
    try {
      await createSupabaseBrowserClient().auth.signOut({ scope: "local" });
    } catch {
      cleanupWarning = true;
    }
    announceSignOut();
  }

  window.location.replace(new URL(
    cleanupWarning ? "/signin?notice=cleanup-pending" : "/signin?notice=signed-out",
    window.location.origin,
  ).toString());
}

export async function acceptRemoteSignOut() {
  try {
    await clearDriveWorkerToken();
  } catch {
    // Redirecting still prevents the stale tab from continuing in the application.
  }
  try {
    await createSupabaseBrowserClient().auth.signOut({ scope: "local" });
  } catch {
    // The initiating tab already requested server-side cookie cleanup.
  }
  if (window.location.pathname !== "/signin") {
    window.location.replace(new URL("/signin?notice=signed-out", window.location.origin).toString());
  }
}
