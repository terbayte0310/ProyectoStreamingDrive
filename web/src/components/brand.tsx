import Link from "next/link";

export function BrandMark() {
  return (
    <span aria-hidden="true" className="brand-mark">
      <svg viewBox="0 0 40 40">
        <defs>
          <linearGradient id="nb-aurora" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ff7a3d" />
            <stop offset=".5" stopColor="#ff3d7f" />
            <stop offset="1" stopColor="#7b61ff" />
          </linearGradient>
        </defs>
        <circle className="brand-core" cx="20" cy="20" fill="url(#nb-aurora)" r="10" />
        <g className="brand-orbit">
          <ellipse cx="20" cy="20" fill="none" rx="18" ry="7" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.6" transform="rotate(-28 20 20)" />
          <circle cx="35" cy="12.4" fill="currentColor" r="2.4" />
        </g>
      </svg>
    </span>
  );
}

export function Brand({ compact = false, href = "/catalog" }: { compact?: boolean; href?: string }) {
  return (
    <Link aria-label="Nébula, ir a la biblioteca" className="brand" href={href}>
      <BrandMark />
      {compact ? null : <span className="brand-word">Nébula</span>}
    </Link>
  );
}
