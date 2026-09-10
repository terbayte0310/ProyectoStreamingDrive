"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const navigation = [
  { href: "/catalog", label: "Inicio" },
  { href: "#continuar", label: "Continuar" },
  { href: "#biblioteca", label: "Biblioteca" },
];

export function AppHeader({ admin = false, email, showNavigation = true }: { admin?: boolean; email?: string; showNavigation?: boolean }) {
  const pathname = usePathname();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (pathname !== "/catalog") return;
    const updateFromHash = () => {
      const index = navigation.findIndex((item) => item.href === window.location.hash);
      setActiveIndex(index >= 0 ? index : 0);
    };
    updateFromHash();
    window.addEventListener("hashchange", updateFromHash);
    return () => window.removeEventListener("hashchange", updateFromHash);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/catalog") return;
    const sections = navigation.slice(1).map((item) => document.querySelector(item.href)).filter(Boolean) as HTMLElement[];
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveIndex(navigation.findIndex((item) => item.href === `#${visible.target.id}`));
      },
      { rootMargin: "-20% 0px -60%", threshold: [0.08, 0.35] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <header className="app-header">
      <Brand />
      {showNavigation ? (
        <nav aria-label="Navegación principal" className="main-nav">
          {navigation.map((item, index) => (
            <Link
              aria-current={activeIndex === index ? "page" : undefined}
              className={`nav-link${activeIndex === index ? " nav-link-active" : ""}`}
              href={item.href}
              key={item.href}
              onClick={() => setActiveIndex(index)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : <div className="admin-header-label">Panel de administración</div>}
      <div className="header-actions">
        {admin && pathname !== "/admin" ? <Link className="header-admin" href="/admin">Admin</Link> : null}
        <ThemeToggle />
        <Link aria-label="Abrir mi cuenta" className="profile-chip" href="/dashboard" title={email ?? "Mi cuenta"}>
          {(email?.[0] ?? "U").toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
