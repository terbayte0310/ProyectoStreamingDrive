"use client";

import { useId, useState, type ReactNode } from "react";

type Entry = { id: string; title: string; category: string; content: ReactNode };
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

export function CatalogCollection({ entries, kind = "media" }: { entries: Entry[]; kind?: "media" | "courses" }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("default");
  const categories = [...new Set(entries.map(entry => entry.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const filtered = entries.filter(entry => (!category || entry.category === category) && normalized(`${entry.title} ${entry.category}`).includes(normalized(query.trim())));
  if (sort === "title") filtered.sort((a, b) => a.title.localeCompare(b.title, "es"));
  return <section className="collection" id="biblioteca" aria-label="Explorar biblioteca">
    <div className="collection-heading"><div><p className="eyebrow">ENCUENTRA TU PRÓXIMA HISTORIA</p><h2>Tu biblioteca</h2></div><span className="collection-count" aria-live="polite">{filtered.length} {filtered.length === 1 ? "título" : "títulos"}</span></div>
    <div className="collection-tools"><label className="collection-search" htmlFor={`${id}-search`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><span className="sr-only">Buscar en esta biblioteca</span><input id={`${id}-search`} type="search" placeholder="Buscar un título o una categoría…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {categories.length > 1 ? <label><span className="sr-only">Categoría</span><select aria-label="Categoría" value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label> : null}
      <label><span className="sr-only">Ordenar</span><select aria-label="Ordenar biblioteca" value={sort} onChange={event => setSort(event.target.value)}><option value="default">Orden de la biblioteca</option><option value="title">Título: A–Z</option></select></label>
    </div>
    {filtered.length ? <div className={kind === "courses" ? "course-grid" : "media-card-grid"}>{filtered.map(entry => <div className="collection-item" key={entry.id}>{entry.content}</div>)}</div> : <div className="collection-empty"><span aria-hidden="true">◎</span><h3>{entries.length ? "No encontramos ese título" : "Tu biblioteca está por comenzar"}</h3><p>{entries.length ? "Prueba con otra palabra o cambia la categoría." : "Los títulos aparecerán aquí cuando se publiquen."}</p>{entries.length ? <button className="secondary-button" onClick={() => { setQuery(""); setCategory(""); }} type="button">Limpiar filtros</button> : null}</div>}
  </section>;
}
