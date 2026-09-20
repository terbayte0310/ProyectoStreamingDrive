"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Icon, type IconName } from "@/components/icons";

export type AdminTab = { content: ReactNode; icon: IconName; id: string; label: string };

/** Pestañas de administración; recuerdan la última abierta mediante el hash de la URL. */
export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    // Solo se lee el hash al montar: el HTML del servidor siempre abre la primera pestaña.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabs.some((tab) => tab.id === fromHash)) setActive(fromHash);
  }, [tabs]);

  function choose(id: string) {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <>
      <div aria-label="Secciones de administración" className="admin-tabs" role="tablist">
        {tabs.map((tab) => (
          <button aria-controls={`panel-${tab.id}`} aria-selected={tab.id === current?.id} className="admin-tab" id={`tab-${tab.id}`} key={tab.id} onClick={() => choose(tab.id)} role="tab" type="button">
            <Icon name={tab.icon} />{tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div aria-labelledby={`tab-${tab.id}`} className={tab.id === current?.id ? "admin-panel-enter" : undefined} hidden={tab.id !== current?.id} id={`panel-${tab.id}`} key={tab.id} role="tabpanel">
          {tab.content}
        </div>
      ))}
    </>
  );
}
