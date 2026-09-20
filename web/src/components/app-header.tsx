"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Brand } from "@/components/brand";
import { Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { completeSignOut } from "@/lib/auth/sign-out-client";

type LibraryModule = "courses" | "movies" | "series";
type NavItem = { href: string; icon: IconName; label: string; match: (path: string) => boolean };

const moduleItems: Record<LibraryModule, NavItem> = {
  courses: { href: "/catalog/cursos", icon: "course", label: "Cursos", match: (path) => path.startsWith("/catalog/cursos") || path.startsWith("/course-player") },
  movies: { href: "/catalog/movies", icon: "film", label: "Películas", match: (path) => path.startsWith("/catalog/movies") },
  series: { href: "/catalog/series", icon: "tv", label: "Series", match: (path) => path.startsWith("/catalog/series") },
};
const moduleOrder: LibraryModule[] = ["courses", "movies", "series"];

export type AppHeaderProps = {
  admin?: boolean;
  email?: string;
  modules?: LibraryModule[];
  /** "media": texto claro mientras la cabecera flota sobre una imagen oscura. */
  tone?: "default" | "media";
};

export function AppHeader({ admin = false, email, modules = [], tone = "default" }: AppHeaderProps) {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const items = moduleOrder.filter((module) => modules.includes(module)).map((module) => moduleItems[module]);
  const accountActive = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => {
      if (window.scrollY > 8) header.dataset.scrolled = "";
      else delete header.dataset.scrolled;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // La píldora activa se desliza hasta el enlace actual.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const thumb = thumbRef.current;
    if (!nav || !thumb) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) { delete thumb.dataset.ready; return; }
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.transform = `translateX(${active.offsetLeft}px)`;
      thumb.dataset.ready = "";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);

  async function signOut() {
    setSigningOut(true);
    await completeSignOut();
  }

  const initial = (email?.[0] ?? "N").toUpperCase();

  return (
    <>
      <header className={`site-header${tone === "media" ? " site-header-dark" : ""}`} ref={headerRef}>
        <div className="site-header-inner">
          <Brand href={items[0]?.href ?? "/catalog"} />
          <nav aria-label="Secciones de la biblioteca" className="main-nav" ref={navRef}>
            <span aria-hidden="true" className="nav-thumb" ref={thumbRef} />
            {items.map((item) => {
              const current = item.match(pathname);
              return (
                <Link aria-current={current ? "page" : undefined} className="nav-link" href={item.href} key={item.href}>
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <button aria-label="Abrir menú de cuenta" className="avatar" popoverTarget="nb-user-menu" title={email ?? "Mi cuenta"} type="button">
              {initial}
            </button>
          </div>
        </div>
      </header>

      <div className="user-menu" id="nb-user-menu" popover="auto">
        <div className="user-menu-head">
          <span aria-hidden="true" className="avatar" style={{ width: 38, height: 38, fontSize: "0.9rem" }}>{initial}</span>
          <div>
            <strong>{email ?? "Tu cuenta"}</strong>
            <span>{admin ? "Administrador" : "Lector"}</span>
          </div>
        </div>
        <Link className="menu-item" href="/dashboard"><Icon name="user" />Mi espacio</Link>
        {admin ? <Link className="menu-item" href="/admin"><Icon name="layers" />Administrar cursos</Link> : null}
        {admin ? <Link className="menu-item" href="/admin/media"><Icon name="film" />Administrar películas y series</Link> : null}
        <button className="menu-item menu-item-danger" disabled={signingOut} onClick={() => void signOut()} type="button">
          <Icon name="logout" />{signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>

      <nav aria-label="Navegación inferior" className="tabbar">
        {items.map((item) => (
          <Link aria-current={item.match(pathname) ? "page" : undefined} className="tab-link" href={item.href} key={item.href}>
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
        <Link aria-current={accountActive ? "page" : undefined} className="tab-link" href="/dashboard">
          <Icon name="user" />
          Cuenta
        </Link>
      </nav>
    </>
  );
}
