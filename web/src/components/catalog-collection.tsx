"use client";

import { type CSSProperties, type ReactNode, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";

type Entry = { category: string; content: ReactNode; id: string; title: string };
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

export function CatalogCollection({ entries, heading = "Toda la biblioteca", kicker = "Explora", kind = "media" }: { entries: Entry[]; heading?: string; kicker?: string; kind?: "courses" | "media" }) {
  const id = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"default" | "title">("default");
  const deferredQuery = useDeferredValue(query);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) if (entry.category) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [entries]);

  const searchable = useMemo(() => entries.map((entry) => ({ entry, text: normalized(`${entry.title} ${entry.category}`) })), [entries]);
  const filtered = useMemo(() => {
    const needle = normalized(deferredQuery.trim());
    const result = searchable.filter(({ entry, text }) => (!category || entry.category === category) && (!needle || text.includes(needle))).map(({ entry }) => entry);
    if (sort === "title") result.sort((a, b) => a.title.localeCompare(b.title, "es"));
    return result;
  }, [category, deferredQuery, searchable, sort]);

  // La barra de filtros se vuelve de cristal cuando queda anclada arriba.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const bar = barRef.current;
    if (!sentinel || !bar) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) delete bar.dataset.stuck;
      else bar.dataset.stuck = "";
    }, { rootMargin: "-90px 0px 0px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // "/" enfoca la búsqueda, como en las herramientas que ya conoces.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtersActive = Boolean(query || category);

  return (
    <section aria-labelledby={`${id}-title`} className="collection section" id="biblioteca">
      <div className="section-head">
        <div>
          <p className="kicker">{kicker}</p>
          <h2 className="title-l" id={`${id}-title`}>{heading}</h2>
        </div>
        <span aria-live="polite" className="result-count">{filtered.length} {filtered.length === 1 ? "título" : "títulos"}</span>
      </div>

      <div aria-hidden="true" ref={sentinelRef} />
      <div className="filter-bar" ref={barRef}>
        <label className="search-box" htmlFor={`${id}-search`}>
          <Icon name="search" />
          <span className="sr-only">Buscar en esta biblioteca</span>
          <input autoComplete="off" className="input" id={`${id}-search`} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por título o categoría" ref={inputRef} type="search" value={query} />
          {!query ? <kbd aria-hidden="true">/</kbd> : null}
        </label>
        <div aria-label="Ordenar" className="segmented" role="group">
          <SegmentedThumb index={sort === "default" ? 0 : 1} />
          <button aria-pressed={sort === "default"} onClick={() => setSort("default")} type="button">Biblioteca</button>
          <button aria-pressed={sort === "title"} onClick={() => setSort("title")} type="button">A–Z</button>
        </div>
        {categories.length > 1 ? (
          <div aria-label="Filtrar por categoría" className="chip-scroller" role="group">
            <button aria-pressed={!category} className="chip" onClick={() => setCategory("")} type="button">Todo <span className="chip-count">{entries.length}</span></button>
            {categories.map(([value, count]) => (
              <button aria-pressed={category === value} className="chip" key={value} onClick={() => setCategory(category === value ? "" : value)} type="button">
                {value} <span className="chip-count">{count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {filtered.length ? (
        <div className={kind === "courses" ? "course-grid" : "poster-grid"}>
          {filtered.map((entry, index) => <div className="collection-item" key={entry.id} style={{ "--i": index } as CSSProperties}>{entry.content}</div>)}
        </div>
      ) : (
        <div className="empty-state">
          <span aria-hidden="true" className="empty-orb" />
          <h3 className="title-m">{entries.length ? "Nada coincide con tu búsqueda" : "Tu biblioteca está por comenzar"}</h3>
          <p>{entries.length ? "Prueba con otra palabra o quita el filtro de categoría." : "Los títulos aparecerán aquí en cuanto se publiquen."}</p>
          {filtersActive ? <button className="btn btn-ghost" onClick={() => { setQuery(""); setCategory(""); }} type="button">Limpiar filtros</button> : null}
        </div>
      )}
    </section>
  );
}

/** Píldora deslizante para controles segmentados de dos o más opciones iguales. */
export function SegmentedThumb({ count = 2, index }: { count?: number; index: number }) {
  return <span aria-hidden="true" className="segmented-thumb" style={{ transform: `translateX(calc(${index} * 100% + 4px))`, width: `calc((100% - 8px) / ${count})` }} />;
}
