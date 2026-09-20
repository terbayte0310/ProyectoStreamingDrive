"use client";

import { useState } from "react";

import { Icon } from "@/components/icons";
import { completeSignOut } from "@/lib/auth/sign-out-client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-ghost" disabled={busy} onClick={() => { setBusy(true); void completeSignOut(); }} type="button">
      <Icon name="logout" />{busy ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
  );
}
