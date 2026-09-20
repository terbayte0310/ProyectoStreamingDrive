"use client";

import type { MouseEvent } from "react";

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

export function ThemeToggle({ className = "header-icon" }: { className?: string }) {
  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    const apply = () => {
      root.dataset.theme = next;
      try { localStorage.setItem("nebula-theme", next); } catch { /* El tema sigue funcionando sin almacenamiento. */ }
    };

    const doc = document as ViewTransitionDocument;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduced) { apply(); return; }

    // El nuevo tema se revela como un círculo que nace del propio botón.
    const { clientX, clientY } = event.nativeEvent;
    const x = clientX || window.innerWidth - 60;
    const y = clientY || 36;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty("--tx", `${x}px`);
    root.style.setProperty("--ty", `${y}px`);
    root.style.setProperty("--tr", `${radius}px`);
    root.dataset.themeSwitching = "";
    doc.startViewTransition(apply).finished.finally(() => { delete root.dataset.themeSwitching; });
  }

  return (
    <button aria-label="Cambiar entre tema claro y oscuro" className={`theme-toggle ${className}`} onClick={toggle} title="Cambiar tema" type="button">
      <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24">
        <mask id="nb-moon-mask">
          <rect fill="#fff" height="24" width="24" />
          <circle className="moon-bite" cx="17" cy="7" fill="#000" r="6" />
        </mask>
        <circle className="sun-core" cx="12" cy="12" fill="currentColor" mask="url(#nb-moon-mask)" r="4.6" stroke="none" />
        <g className="sun-rays">
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </g>
      </svg>
    </button>
  );
}
