"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type MediaKind = "movie" | "series" | "season" | "episode";
type MediaStatus = "draft" | "published";

export type AdminMediaRecord = {
  admin_code: string | null;
  admin_title: string;
  episode_number?: number;
  id: string;
  internal_code: string;
  season_id?: string;
  season_number?: number;
  status: MediaStatus;
};

export type TmdbMetadata = {
  backdrop_path: string | null;
  episode_id: string | null;
  genres: Array<{ id: number; name: string }>;
  id: string;
  localized_title: string | null;
  movie_id?: string | null;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  release_date: string | null;
  runtime_minutes: number | null;
  season_id: string | null;
  series_id: string | null;
  synced_at: string | null;
  tmdb_id: number | null;
  tmdb_url: string | null;
  vote_average: number | null;
  vote_count: number | null;
};

type Selection = { id: string; kind: MediaKind } | null;
type TmdbSearchResult = { id: number; originalTitle: string | null; posterPath: string | null; releaseDate: string | null; title: string | null };

function titleFor(record: AdminMediaRecord) {
  return record.admin_title || record.internal_code;
}

function statusLabel(status: MediaStatus) {
  return status === "published" ? "Publicado" : "Borrador";
}

export function AdminMediaManager({
  initialMetadata,
  initialMovies,
  initialSeries,
}: {
  initialMetadata: TmdbMetadata[];
  initialMovies: AdminMediaRecord[];
  initialSeries: AdminMediaRecord[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"movies" | "series">("movies");
  const [movies, setMovies] = useState(initialMovies);
  const [series, setSeries] = useState(initialSeries);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [seasons, setSeasons] = useState<AdminMediaRecord[]>([]);
  const [episodes, setEpisodes] = useState<AdminMediaRecord[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(initialSeries[0]?.id ?? null);
  const [selection, setSelection] = useState<Selection>(initialMovies[0] ? { id: initialMovies[0].id, kind: "movie" } : initialSeries[0] ? { id: initialSeries[0].id, kind: "series" } : null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);

  const selected = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "movie") return movies.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === "series") return series.find((item) => item.id === selection.id) ?? null;
    if (selection.kind === "season") return seasons.find((item) => item.id === selection.id) ?? null;
    return episodes.find((item) => item.id === selection.id) ?? null;
  }, [episodes, movies, seasons, selection, series]);

  async function loadSeries(seriesId: string) {
    setBusy("load:" + seriesId);
    try {
      const response = await fetch("/api/admin/media?seriesId=" + encodeURIComponent(seriesId), { cache: "no-store" });
      const result = await response.json() as { episodes?: AdminMediaRecord[]; error?: string; metadata?: TmdbMetadata[]; seasons?: AdminMediaRecord[] };
      if (!response.ok || !result.seasons || !result.episodes || !result.metadata) throw new Error(result.error ?? "No se pudo cargar la serie.");
      setSeasons(result.seasons);
      setEpisodes(result.episodes);
      setMetadata((current) => [...current.filter((entry) => entry.series_id !== seriesId && !result.seasons!.some((season) => season.id === entry.season_id) && !result.episodes!.some((episode) => episode.id === entry.episode_id)), ...result.metadata!]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la serie.");
    } finally {
      setBusy("");
    }
  }

  function choose(kind: MediaKind, id: string) {
    if (kind === "series") {
      setActiveSeriesId(id);
      void loadSeries(id);
    }
    setSelection({ id, kind });
    setMessage("");
    setSearch("");
    setSearchResults([]);
  }

  function currentMetadata() {
    if (!selection) return null;
    const relation = selection.kind + "_id";
    return metadata.find((entry) => (entry as Record<string, unknown>)[relation] === selection.id) ?? null;
  }

  function replaceRecord(kind: MediaKind, item: AdminMediaRecord) {
    const replace = (records: AdminMediaRecord[]) => records.map((record) => record.id === item.id ? { ...record, ...item } : record);
    if (kind === "movie") setMovies(replace);
    else if (kind === "series") setSeries(replace);
    else if (kind === "season") setSeasons(replace);
    else setEpisodes(replace);
  }

  async function requestMedia(body: object) {
    const response = await fetch("/api/admin/media", {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = await response.json() as { error?: string; item?: AdminMediaRecord };
    if (!response.ok || !result.item) throw new Error(result.error ?? "No se pudo guardar el contenido.");
    return result.item;
  }

  async function createRecord(event: FormEvent<HTMLFormElement>, kind: "movie" | "series" | "season" | "episode", parentId?: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("create:" + kind);
    setMessage("");
    try {
      const item = await requestMedia({
        action: "create",
        adminCode: form.get("adminCode"),
        kind,
        parentId,
        status: form.get("status"),
        title: form.get("title"),
      });
      if (kind === "movie") setMovies((current) => [...current, item]);
      else if (kind === "series") setSeries((current) => [...current, item]);
      else if (kind === "season") {
        if (parentId) await loadSeries(parentId);
      } else if (parentId && activeSeriesId) {
        await loadSeries(activeSeriesId);
      }
      choose(kind, item.id);
      event.currentTarget.reset();
      setMessage("Contenido creado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el contenido.");
    } finally {
      setBusy("");
    }
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || !selected) return;
    const form = new FormData(event.currentTarget);
    setBusy("save:" + selected.id);
    setMessage("");
    try {
      const item = await requestMedia({
        action: "update",
        adminCode: form.get("adminCode"),
        contentId: selected.id,
        kind: selection.kind,
        status: form.get("status"),
        title: form.get("title"),
      });
      replaceRecord(selection.kind, item);
      setMessage("Contenido guardado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el contenido.");
    } finally {
      setBusy("");
    }
  }

  async function searchTmdb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || (selection.kind !== "movie" && selection.kind !== "series") || !search.trim()) return;
    setBusy("search");
    setMessage("");
    try {
      const response = await fetch("/api/admin/tmdb", {
        body: JSON.stringify({ action: "search", contentKind: selection.kind, query: search.trim() }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json() as { error?: string; results?: TmdbSearchResult[] };
      if (!response.ok || !result.results) throw new Error(result.error ?? "No se pudo buscar en TMDB.");
      setSearchResults(result.results);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo buscar en TMDB.");
    } finally {
      setBusy("");
    }
  }

  async function tmdbAction(action: "link" | "refresh" | "unlink", tmdbId?: number) {
    if (!selection) return;
    if (action === "unlink" && !window.confirm("Se eliminará la asociación y la caché de TMDB, pero no el contenido interno. ¿Continuar?")) return;
    setBusy("tmdb:" + action);
    setMessage("");
    try {
      const response = await fetch("/api/admin/tmdb", {
        body: JSON.stringify({ action, contentId: selection.id, contentKind: selection.kind, tmdbId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo actualizar TMDB.");
      setSearchResults([]);
      setSearch("");
      router.refresh();
      if (selection.kind === "series") await loadSeries(selection.id);
      setMessage(action === "unlink" ? "TMDB desvinculado." : "Caché de TMDB actualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar TMDB.");
    } finally {
      setBusy("");
    }
  }

  const meta = currentMetadata();
  const isSeriesDraft = selection?.kind === "season" || selection?.kind === "episode"
    ? series.find((item) => item.id === activeSeriesId)?.status === "draft"
    : false;

  return (
    <section className="admin-manager admin-reveal mt-8 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="admin-panel p-3">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-950/5 p-1">
          <button className={tab === "movies" ? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white" : "rounded-lg px-3 py-2 text-sm"} onClick={() => { setTab("movies"); if (movies[0]) choose("movie", movies[0].id); }} type="button">Movies</button>
          <button className={tab === "series" ? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white" : "rounded-lg px-3 py-2 text-sm"} onClick={() => { setTab("series"); if (series[0]) choose("series", series[0].id); }} type="button">Series</button>
        </div>
        <h2 className="px-2 pb-2 font-semibold">{tab === "movies" ? "Películas" : "Series"}</h2>
        <div className="flex max-h-[48vh] flex-col gap-1 overflow-y-auto">
          {(tab === "movies" ? movies : series).map((item) => (
            <button aria-current={selection?.id === item.id ? "true" : undefined} className={"admin-course-option px-3 py-3 text-left text-sm " + (selection?.id === item.id ? "admin-course-option-active" : "")} key={item.id} onClick={() => choose(tab === "movies" ? "movie" : "series", item.id)} type="button">
              {titleFor(item)}
              <span className="ml-2 text-xs text-slate-400">{statusLabel(item.status)}</span>
            </button>
          ))}
        </div>
        <form className="mt-4 grid gap-2 border-t border-slate-200 pt-4" onSubmit={(event) => void createRecord(event, tab === "movies" ? "movie" : "series")}>
          <input aria-label={"Nueva " + (tab === "movies" ? "película" : "serie")} className="admin-input rounded-lg border px-3 py-2 text-sm" name="title" placeholder={tab === "movies" ? "Nueva película" : "Nueva serie"} required />
          <input aria-label="Código legible opcional" className="admin-input rounded-lg border px-3 py-2 text-sm" name="adminCode" placeholder="Código legible opcional" />
          <select className="admin-input rounded-lg border px-3 py-2 text-sm" defaultValue="draft" name="status"><option value="draft">Borrador</option><option value="published">Publicado</option></select>
          <button className="primary-button text-sm disabled:opacity-50" disabled={Boolean(busy)} type="submit">Crear</button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        {selected ? (
          <>
            <form className="admin-panel p-6" key={selection?.kind + ":" + selected.id} onSubmit={saveRecord}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="eyebrow">{selection?.kind === "movie" ? "Película" : selection?.kind === "series" ? "Serie" : selection?.kind === "season" ? "Temporada" : "Episodio"}</p><h2 className="mt-1 text-2xl font-semibold">{titleFor(selected)}</h2></div>
                <code className="rounded-lg bg-slate-950/5 px-3 py-2 text-xs">{selected.internal_code}</code>
              </div>
              {isSeriesDraft ? <p className="mt-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">La serie padre está en borrador: este contenido no será visible para lectores aunque esté publicado.</p> : null}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">Título administrativo<input className="admin-input rounded-lg border px-3 py-2" defaultValue={selected.admin_title} name="title" required /></label>
                <label className="flex flex-col gap-1 text-sm">Código legible opcional<input className="admin-input rounded-lg border px-3 py-2" defaultValue={selected.admin_code ?? ""} name="adminCode" placeholder="HPPF-00001" /></label>
                <label className="flex flex-col gap-1 text-sm">Estado<select className="admin-input rounded-lg border px-3 py-2" defaultValue={selected.status} name="status"><option value="draft">Borrador</option><option value="published">Publicado</option></select></label>
                <p className="self-end text-sm text-slate-500">Código interno: <code>{selected.internal_code}</code></p>
              </div>
              <button className="primary-button mt-5 disabled:opacity-50" disabled={Boolean(busy)} type="submit">{busy === "save:" + selected.id ? "Guardando…" : "Guardar"}</button>
            </form>

            <section className="admin-panel p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Metadatos</p><h2 className="mt-1 text-xl font-semibold">TMDB</h2></div>{meta?.tmdb_url ? <a className="secondary-button text-sm" href={meta.tmdb_url} rel="noreferrer" target="_blank">Ver en TMDB ↗</a> : null}</div>
              {meta ? <div className="mt-4 grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">{meta.poster_path ? <Image alt="" className="aspect-[2/3] w-28 rounded-xl object-cover" height={513} src={"https://image.tmdb.org/t/p/w342" + meta.poster_path} width={342} /> : null}<div><h3 className="font-semibold">{meta.localized_title ?? meta.original_title}</h3><p className="mt-1 text-sm text-slate-500">{meta.overview || "Sin sinopsis disponible."}</p><p className="mt-3 text-sm">{meta.genres.map((genre) => genre.name).join(" · ") || "Sin géneros"}{meta.release_date ? " · " + meta.release_date : ""}{meta.runtime_minutes !== null ? " · " + meta.runtime_minutes + " min" : ""}</p><p className="mt-2 text-xs text-slate-500">Caché actualizada: {meta.synced_at ? new Date(meta.synced_at).toLocaleString() : "sin fecha"}</p></div></div> : <p className="mt-4 text-sm text-slate-500">Todavía no hay datos cacheados de TMDB.</p>}
              {selection?.kind === "movie" || selection?.kind === "series" ? <form className="mt-5 flex flex-wrap gap-2" onSubmit={(event) => void searchTmdb(event)}><input className="admin-input min-w-56 flex-1 rounded-lg border px-3 py-2 text-sm" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en TMDB" value={search} /><button className="secondary-button text-sm disabled:opacity-50" disabled={Boolean(busy)} type="submit">Buscar</button></form> : null}
              {searchResults.length ? <div className="mt-3 grid gap-2">{searchResults.map((result) => <button className="rounded-xl border border-slate-200 p-3 text-left text-sm hover:border-blue-400" key={result.id} onClick={() => void tmdbAction("link", result.id)} type="button"><strong>{result.title ?? result.originalTitle ?? "Sin título"}</strong><span className="ml-2 text-slate-500">{result.releaseDate ?? ""}</span></button>)}</div> : null}
              <div className="mt-5 flex flex-wrap gap-2">{(selection?.kind === "season" || selection?.kind === "episode") && !meta ? <button className="secondary-button text-sm disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void tmdbAction("link")} type="button">Vincular desde la serie</button> : null}{meta ? <><button className="secondary-button text-sm disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void tmdbAction("refresh")} type="button">Refrescar</button><button className="rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void tmdbAction("unlink")} type="button">Desvincular</button></> : null}</div>
              <p className="mt-4 text-xs text-slate-500">Datos e imágenes proporcionados por TMDB. Esta aplicación no está respaldada ni certificada por TMDB.</p>
            </section>

            {selection?.kind === "series" ? <section className="admin-panel p-6"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Estructura</p><h2 className="mt-1 text-xl font-semibold">Temporadas y episodios</h2></div>{busy === "load:" + selected.id ? <span className="text-sm text-slate-500">Cargando…</span> : null}</div><form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => void createRecord(event, "season", selected.id)}><input className="admin-input min-w-56 flex-1 rounded-lg border px-3 py-2 text-sm" name="title" placeholder="Título de nueva temporada" required /><input className="admin-input rounded-lg border px-3 py-2 text-sm" name="adminCode" placeholder="Código opcional" /><input name="status" type="hidden" value="draft" /><button className="secondary-button text-sm" type="submit">Añadir temporada</button></form><div className="mt-4 grid gap-3">{seasons.map((season) => <div className="rounded-xl border border-slate-200 p-4" key={season.id}><button className="font-semibold" onClick={() => choose("season", season.id)} type="button">T{season.season_number}: {titleFor(season)}</button><span className="ml-2 text-xs text-slate-500">{statusLabel(season.status)}</span><div className="mt-3 grid gap-2 border-l-2 border-blue-100 pl-3">{episodes.filter((episode) => episode.season_id === season.id).map((episode) => <button className="text-left text-sm text-slate-600 hover:text-blue-600" key={episode.id} onClick={() => choose("episode", episode.id)} type="button">E{episode.episode_number}: {titleFor(episode)} · {statusLabel(episode.status)}</button>)}</div><form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => void createRecord(event, "episode", season.id)}><input className="admin-input min-w-48 flex-1 rounded-lg border px-3 py-2 text-sm" name="title" placeholder="Título de nuevo episodio" required /><input className="admin-input rounded-lg border px-3 py-2 text-sm" name="adminCode" placeholder="Código opcional" /><input name="status" type="hidden" value="draft" /><button className="secondary-button text-sm" type="submit">Añadir episodio</button></form></div>)}</div></section> : null}
          </>
        ) : <section className="admin-panel p-8 text-slate-500">Crea o selecciona una película o serie para comenzar.</section>}
        {message ? <p className={message.includes("No se pudo") || message.includes("obligatorio") ? "text-rose-600" : "text-emerald-600"}>{message}</p> : null}
      </div>
    </section>
  );
}
