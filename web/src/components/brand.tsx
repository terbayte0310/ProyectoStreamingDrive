import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Ir a la biblioteca" className="brand" href="/catalog">
      <span aria-hidden="true" className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      {compact ? null : <span className="brand-word">Nébula</span>}
    </Link>
  );
}
