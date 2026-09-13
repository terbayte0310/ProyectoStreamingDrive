"use client";

import { useEffect } from "react";

import { acceptRemoteSignOut, prepareDriveWorker, subscribeToSignOut } from "@/lib/auth/sign-out-client";

export function SessionSignOutCoordinator() {
  useEffect(() => {
    prepareDriveWorker();
    let handled = false;
    return subscribeToSignOut(() => {
      if (handled) return;
      handled = true;
      void acceptRemoteSignOut();
    });
  }, []);

  return null;
}
