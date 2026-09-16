"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
export function AppHeader({ admin = false, contextLabel = "Tu biblioteca privada", email, showNavigation = true }: { admin?: boolean; contextLabel?: string; email?: string; showNavigation?: boolean }) {
  const pathname = usePathname();
  return <header className="app-header"><Brand /><nav aria-label="Navegación principal" className="main-nav">
    <Link className={`nav-link${pathname.startsWith("/catalog") ? " nav-link-active" : ""}`} aria-current={pathname.startsWith("/catalog") ? "page" : undefined} href="/catalog">Explorar</Link>
    <Link className={`nav-link${pathname === "/dashboard" ? " nav-link-active" : ""}`} aria-current={pathname === "/dashboard" ? "page" : undefined} href="/dashboard">Mi espacio</Link>
    {!showNavigation ? <span className="header-context">{contextLabel}</span> : null}
    </nav><div className="header-actions">{admin && !pathname.startsWith("/admin") ? <Link className="header-admin" href="/admin">Administrar</Link> : null}<ThemeToggle /><Link aria-label="Abrir mi cuenta" className="profile-chip" href="/dashboard" title={email ?? "Mi cuenta"}>{(email?.[0] ?? "N").toUpperCase()}</Link></div></header>;
}
