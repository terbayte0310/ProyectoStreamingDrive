"use client";

import { useRouter } from "next/navigation";
import { type CSSProperties, type FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { SegmentedThumb } from "@/components/catalog-collection";
import { Icon } from "@/components/icons";
import { MediaPoster, tmdbImage } from "@/components/media-catalog";
import { MediaInventoryImport } from "@/components/media-inventory-import";
import { mapEpisodeOrdinalToTmdb } from "@/lib/tmdb/episode-mapping";
import { PublishReadyMedia } from "@/components/publish-ready-media";
import { toast } from "@/components/toaster";
import { AdminTabs } from "@/components/ui/admin-tabs";
import { confirmDialog } from "@/components/ui/confirm";

type MediaKind = "movie" | "series" | "season" | "episode";
type MediaStatus = "draft" | "published";

export type AdminMediaRecord = { admin_code: string | null; admin_title: string; episode_number?: number; id: string; internal_code: string; season_id?: string; season_number?: number; status: MediaStatus };
export type TmdbMetadata = {
  backdrop_path: string | null; episode_id: string | null; genres: Array<{ id: number; name: string }>; id: string; localized_title: string | null; movie_id?: string | null;
  original_title: string | null; overview: string | null; poster_path: string | null; release_date: string | null; runtime_minutes: number | null; season_id: string | null;
  raw_payload?: Record<string, unknown> | null; series_id: string | null; synced_at: string | null; tmdb_id: number | null; tmdb_url: string | null; vote_average: number | null; vote_count: number | null;
};

type Selection = { id: string; kind: MediaKind } | null;
type TmdbSearchResult = { id: number; originalTitle: string | null; posterPath: string | null; releaseDate: string | null; title: string | null };
export type PlaybackSource = { drive_root_folder_id: string; id: string; is_active: boolean; name: string };
type PlaybackPackage = { drive_root_folder_id: string; episode_id: string | null; id: string; last_error: string | null; movie_id: string | null; source_id: string; status: "draft" | "ready" | "review" | "unavailable" };

const kindLabel: Record<MediaKind, string> = { episode: "Episodio", movie: "Película", season: "Temporada", series: "Serie" };
const packageBadge: Record<PlaybackPackage["status"], string> = { draft: "badge badge-gold badge-dot", ready: "badge badge-mint badge-dot", review: "badge badge-gold badge-dot", unavailable: "badge badge-rose badge-dot" };
const packageLabel: Record<PlaybackPackage["status"], string> = { draft: "Borrador", ready: "Listo", review: "En revisión", unavailable: "No disponible" };
const titleFor = (record: AdminMediaRecord) => record.admin_title || record.internal_code;
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

type SeriesPayload = { episodes: AdminMediaRecord[]; metadata: TmdbMetadata[]; seasons: AdminMediaRecord[] };

async function fetchSeries(seriesId: string): Promise<SeriesPayload> {
  const response = await fetch(`/api/admin/media?seriesId=${encodeURIComponent(seriesId)}`, { cache: "no-store" });
  const result = await response.json() as Partial<SeriesPayload> & { error?: string };
  if (!response.ok || !result.seasons || !result.episodes || !result.metadata) throw new Error(result.error ?? "No se pudo cargar la serie.");
  return { episodes: result.episodes, metadata: result.metadata, seasons: result.seasons };
}

async function fetchPlaybackConfiguration() {
  const response = await fetch("/api/drive-token/media-playback", { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as { packages?: PlaybackPackage[]; sources?: PlaybackSource[] };
  return response.ok ? { packages: result.packages ?? [], sources: result.sources ?? [] } : null;
}

async function postJson<T>(url: string, body: object) {
  const response = await fetch(url, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST" });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "La operación no se pudo completar.");
  return result;
}

export function AdminMediaManager({ initialMetadata, initialMovies, initialSeries }: { initialMetadata: TmdbMetadata[]; initialMovies: AdminMediaRecord[]; initialSeries: AdminMediaRecord[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"movies" | "series">(initialMovies.length || !initialSeries.length ? "movies" : "series");
  const [movies, setMovies] = useState(initialMovies);
  const [series, setSeries] = useState(initialSeries);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [seasons, setSeasons] = useState<AdminMediaRecord[]>([]);
  const [episodes, setEpisodes] = useState<AdminMediaRecord[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(!initialMovies[0] && initialSeries[0] ? initialSeries[0].id : null);
  const [selection, setSelection] = useState<Selection>(initialMovies[0] ? { id: initialMovies[0].id, kind: "movie" } : initialSeries[0] ? { id: initialSeries[0].id, kind: "series" } : null);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sources, setSources] = useState<PlaybackSource[]>([]);
  const [packages, setPackages] = useState<PlaybackPackage[]>([]);

  const loadPlaybackConfiguration = useCallback(async () => {
    const result = await fetchPlaybackConfiguration();
    if (result) { setSources(result.sources); setPackages(result.packages); }
  }, []);
  useEffect(() => {
    let active = true;
    void fetchPlaybackConfiguration().then((result) => { if (active && result) { setSources(result.sources); setPackages(result.packages); } });
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => {
    if (!selection) return null;
    const pool = selection.kind === "movie" ? movies : selection.kind === "series" ? series : selection.kind === "season" ? seasons : episodes;
    return pool.find((item) => item.id === selection.id) ?? null;
  }, [episodes, movies, seasons, selection, series]);

  const list = useMemo(() => {
    const needle = normalized(deferredQuery.trim());
    return (tab === "movies" ? movies : series).filter((item) => !needle || normalized(`${item.admin_title} ${item.internal_code} ${item.admin_code ?? ""}`).includes(needle));
  }, [deferredQuery, movies, series, tab]);

  function applySeries(seriesId: string, result: SeriesPayload) {
    setSeasons(result.seasons);
    setEpisodes(result.episodes);
    setMetadata((current) => [...current.filter((entry) => entry.series_id !== seriesId && !result.seasons.some((season) => season.id === entry.season_id) && !result.episodes.some((episode) => episode.id === entry.episode_id)), ...result.metadata]);
  }

  async function loadSeries(seriesId: string) {
    setBusy(`load:${seriesId}`);
    try {
      applySeries(seriesId, await fetchSeries(seriesId));
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo cargar la serie.", "error");
    } finally {
      setBusy("");
    }
  }

  // Si la vista abre directamente una serie, su estructura se carga al montar.
  useEffect(() => {
    const initialSeries = activeSeriesId;
    if (!initialSeries) return;
    let active = true;
    fetchSeries(initialSeries).then((result) => { if (active) applySeries(initialSeries, result); }, (error: unknown) => toast(error instanceof Error ? error.message : "No se pudo cargar la serie.", "error"));
    return () => { active = false; };
    // Solo en el montaje: las selecciones posteriores llaman a loadSeries directamente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(kind: MediaKind, id: string) {
    setSelection({ id, kind });
    if (kind === "series" && activeSeriesId !== id) {
      setActiveSeriesId(id);
      setSeasons([]);
      setEpisodes([]);
      void loadSeries(id);
    }
  }

  function replaceRecord(kind: MediaKind, item: AdminMediaRecord) {
    const replace = (records: AdminMediaRecord[]) => records.map((record) => (record.id === item.id ? { ...record, ...item } : record));
    if (kind === "movie") setMovies(replace); else if (kind === "series") setSeries(replace); else if (kind === "season") setSeasons(replace); else setEpisodes(replace);
  }

  async function createRecord(event: FormEvent<HTMLFormElement>, kind: MediaKind, parentId?: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(`create:${kind}`);
    try {
      const { item } = await postJson<{ item?: AdminMediaRecord }>("/api/admin/media", { action: "create", adminCode: form.get("adminCode"), kind, parentId, status: form.get("status") ?? "draft", title: form.get("title") });
      if (!item) throw new Error("No se pudo crear el contenido.");
      if (kind === "movie") setMovies((current) => [...current, item]);
      else if (kind === "series") setSeries((current) => [...current, item]);
      else if (activeSeriesId) await loadSeries(activeSeriesId);
      choose(kind, item.id);
      formElement.reset();
      toast(`${kindLabel[kind]} creada: ${titleFor(item)}.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo crear el contenido.", "error");
    } finally {
      setBusy("");
    }
  }

  const currentMetadata = selection ? metadata.find((entry) => (entry as Record<string, unknown>)[`${selection.kind}_id`] === selection.id) ?? null : null;
  const parentSeries = activeSeriesId ? series.find((item) => item.id === activeSeriesId) : undefined;
  const selectedSeason = selection?.kind === "episode" ? seasons.find((season) => season.id === selected?.season_id) : selection?.kind === "season" ? seasons.find((season) => season.id === selection.id) : undefined;
  const playbackPackage = selection ? packages.find((entry) => (selection.kind === "movie" ? entry.movie_id === selection.id : selection.kind === "episode" ? entry.episode_id === selection.id : false)) : undefined;

  const catalog = (
    <div className="workspace">
      <aside aria-label="Contenido" className="panel master">
        <div className="master-tools">
          <div aria-label="Tipo de contenido" className="segmented" role="group" style={{ width: "100%" }}>
            <SegmentedThumb index={tab === "movies" ? 0 : 1} />
            <button aria-pressed={tab === "movies"} onClick={() => { setTab("movies"); if (movies[0]) choose("movie", movies[0].id); }} type="button">Películas · {movies.length}</button>
            <button aria-pressed={tab === "series"} onClick={() => { setTab("series"); if (series[0]) choose("series", series[0].id); }} type="button">Series · {series.length}</button>
          </div>
          <label className="search-box">
            <Icon name="search" />
            <span className="sr-only">Buscar</span>
            <input className="input" onChange={(event) => setQuery(event.target.value)} placeholder="Título o código" type="search" value={query} />
          </label>
        </div>
        <div className="master-list">
          {list.map((item) => {
            const current = selection?.id === item.id || (tab === "series" && activeSeriesId === item.id && (selection?.kind === "season" || selection?.kind === "episode"));
            return (
              <button aria-current={current} className="master-item" key={item.id} onClick={() => choose(tab === "movies" ? "movie" : "series", item.id)} type="button">
                <span>{titleFor(item)}<br /><small className="mono subtle">{item.internal_code}</small></span>
                <span className="status-dot" data-status={item.status} title={item.status === "published" ? "Publicado" : "Borrador"} />
              </button>
            );
          })}
          {!list.length ? <p className="muted" style={{ margin: 0, padding: "0.8rem" }}>Nada coincide.</p> : null}
        </div>
        <form className="master-foot" onSubmit={(event) => void createRecord(event, tab === "movies" ? "movie" : "series")} style={{ display: "grid", gap: 8 }}>
          <input aria-label={tab === "movies" ? "Nueva película" : "Nueva serie"} className="input input-sm" name="title" placeholder={tab === "movies" ? "Nueva película" : "Nueva serie"} required />
          <div style={{ display: "flex", gap: 8 }}>
            <input aria-label="Código legible opcional" className="input input-sm" name="adminCode" placeholder="Código (opcional)" />
            <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} type="submit"><Icon name="plus" />Crear</button>
          </div>
        </form>
      </aside>

      {selected && selection ? (
        <div style={{ minWidth: 0 }}>
          {(selection.kind === "season" || selection.kind === "episode") && parentSeries ? (
            <nav aria-label="Ruta" className="breadcrumb" style={{ marginBottom: 10 }}>
              <button onClick={() => choose("series", parentSeries.id)} type="button">{titleFor(parentSeries)}</button>
              <Icon name="chevronRight" width={14} />
              {selectedSeason ? <button onClick={() => choose("season", selectedSeason.id)} type="button">Temporada {selectedSeason.season_number}</button> : null}
              {selection.kind === "episode" ? <><Icon name="chevronRight" width={14} /><span>Episodio {selected.episode_number}</span></> : null}
            </nav>
          ) : null}

          <GeneralForm isParentDraft={(selection.kind === "season" || selection.kind === "episode") && parentSeries?.status === "draft"} key={`${selection.kind}:${selected.id}`} kind={selection.kind} onSaved={(item) => replaceRecord(selection.kind, item)} record={selected} />

          {selection.kind === "series" ? (
            <section className="panel panel-pad">
              <div className="panel-head">
                <div><p className="kicker">Estructura</p><h2 className="title-m">Temporadas y episodios</h2></div>
                {busy === `load:${selected.id}` ? <span className="orbit-loader" style={{ "--size": "26px" } as CSSProperties}><span /></span> : null}
              </div>
              <form className="inline-form" onSubmit={(event) => void createRecord(event, "season", selected.id)} style={{ marginBottom: 14 }}>
                <input className="input input-sm" name="title" placeholder="Título de nueva temporada" required />
                <input className="input input-sm" name="adminCode" placeholder="Código opcional" style={{ flex: "0 1 160px" }} />
                <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} type="submit"><Icon name="plus" />Temporada</button>
              </form>
              <div className="tree">
                {seasons.map((season) => (
                  <div className="tree-season" key={season.id}>
                    <button onClick={() => choose("season", season.id)} type="button">
                      <span>T{season.season_number} · {titleFor(season)}</span>
                      <span className={season.status === "published" ? "badge badge-mint" : "badge badge-gold"}>{season.status === "published" ? "Publicada" : "Borrador"}</span>
                    </button>
                    <div className="tree-episodes">
                      {episodes.filter((episode) => episode.season_id === season.id).map((episode) => {
                        const hasPackage = packages.some((entry) => entry.episode_id === episode.id && entry.status === "ready");
                        return (
                          <button className="tree-episode" key={episode.id} onClick={() => choose("episode", episode.id)} type="button">
                            <span><span className="mono subtle">E{String(episode.episode_number).padStart(2, "0")}</span> {titleFor(episode)}</span>
                            <span style={{ display: "flex", gap: 6 }}>{hasPackage ? <span className="badge badge-mint">HLS</span> : null}<span className="status-dot" data-status={episode.status} /></span>
                          </button>
                        );
                      })}
                      <form className="inline-form" onSubmit={(event) => void createRecord(event, "episode", season.id)} style={{ padding: "0.4rem 0.2rem 0.2rem" }}>
                        <input className="input input-sm" name="title" placeholder="Nuevo episodio" required />
                        <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} type="submit"><Icon name="plus" />Episodio</button>
                      </form>
                    </div>
                  </div>
                ))}
                {!seasons.length && busy !== `load:${selected.id}` ? <p className="muted" style={{ margin: 0 }}>Esta serie aún no tiene temporadas.</p> : null}
              </div>
            </section>
          ) : null}

          <TmdbPanel
            episodes={selection.kind === "series" ? episodes : []}
            kind={selection.kind}
            seasons={selection.kind === "series" ? seasons : []}
            metadata={currentMetadata}
            onChanged={async () => { router.refresh(); if (selection.kind !== "movie" && activeSeriesId) await loadSeries(activeSeriesId); }}
            selectionId={selection.id}
          />

          {selection.kind === "movie" || selection.kind === "episode" ? (
            <PlaybackPanel
              contentId={selection.id}
              kind={selection.kind}
              onScanned={(entry) => setPackages((current) => [...current.filter((item) => item.movie_id !== selection.id && item.episode_id !== selection.id), entry])}
              playbackPackage={playbackPackage}
              sources={sources}
            />
          ) : null}
        </div>
      ) : (
        <div className="empty-state"><span aria-hidden="true" className="empty-orb" /><h2 className="title-m">Crea o elige un título</h2><p>Empieza por una película o una serie en la columna izquierda, o importa un inventario completo.</p></div>
      )}
    </div>
  );

  return (
    <AdminTabs
      tabs={[
        { content: catalog, icon: "grid", id: "catalogo", label: "Catálogo" },
        {
          content: (
            <div className="ops-grid">
              <MediaInventoryImport onFinished={loadPlaybackConfiguration} sources={sources} />
              <PublishReadyMedia sources={sources} />
            </div>
          ),
          icon: "upload",
          id: "carga",
          label: "Carga masiva y publicación",
        },
        { content: <SourcesPanel onCreated={(source) => setSources((current) => [...current, source])} onSynced={loadPlaybackConfiguration} sources={sources} />, icon: "layers", id: "fuentes", label: "Fuentes de Drive" },
      ]}
    />
  );
}

function GeneralForm({ isParentDraft, kind, onSaved, record }: { isParentDraft: boolean; kind: MediaKind; onSaved: (item: AdminMediaRecord) => void; record: AdminMediaRecord }) {
  const initial = { adminCode: record.admin_code ?? "", status: record.status, title: record.admin_title };
  const [original, setOriginal] = useState(initial);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const { item } = await postJson<{ item?: AdminMediaRecord }>("/api/admin/media", { action: "update", adminCode: form.adminCode, contentId: record.id, kind, status: form.status, title: form.title });
      if (!item) throw new Error("No se pudo guardar el contenido.");
      onSaved(item);
      const next = { adminCode: item.admin_code ?? "", status: item.status, title: item.admin_title };
      setOriginal(next);
      setForm(next);
      toast("Cambios guardados.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo guardar el contenido.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel panel-pad" onSubmit={save}>
      <div className="panel-head">
        <div><p className="kicker">{kindLabel[kind]}</p><h2 className="title-m">{form.title || record.internal_code}</h2></div>
        <span className="code-pill">{record.internal_code}</span>
      </div>
      {isParentDraft ? <div className="notice notice-warn" style={{ marginBottom: 16 }}><span className="notice-icon"><Icon name="eyeOff" /></span><div>La serie padre está en borrador: esto no será visible para lectores aunque lo publiques.</div></div> : null}
      <div className="form-grid">
        <label className="field"><span className="field-label">Título administrativo</span><input className="input" onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
        <label className="field"><span className="field-label">Código legible (opcional)</span><input className="input" onChange={(event) => setForm({ ...form, adminCode: event.target.value })} placeholder="HPPF-00001" value={form.adminCode} /></label>
        <div className="field span-2">
          <span className="field-label">Estado</span>
          <div aria-label="Estado de publicación" className="segmented" role="group" style={{ width: "fit-content" }}>
            <SegmentedThumb index={form.status === "draft" ? 0 : 1} />
            <button aria-pressed={form.status === "draft"} onClick={() => setForm({ ...form, status: "draft" })} type="button">Borrador</button>
            <button aria-pressed={form.status === "published"} onClick={() => setForm({ ...form, status: "published" })} type="button">Publicado</button>
          </div>
        </div>
      </div>
      {dirty ? (
        <div className="save-bar" role="status">
          <span>Cambios sin guardar</span>
          <div>
            <button className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setForm(original)} type="button">Descartar</button>
            <button className="btn btn-primary btn-sm" disabled={saving} type="submit"><Icon name="check" />{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function TmdbPanel({ episodes = [], kind, metadata, onChanged, seasons = [], selectionId }: { episodes?: AdminMediaRecord[]; kind: MediaKind; metadata: TmdbMetadata | null; onChanged: () => Promise<void>; seasons?: AdminMediaRecord[]; selectionId: string }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [busy, setBusy] = useState("");
  const [episodeProgress, setEpisodeProgress] = useState<{ done: number; total: number } | null>(null);
  const canSearch = kind === "movie" || kind === "series";
  const displayPoster = metadata?.poster_path ?? (kind === "episode" ? metadata?.backdrop_path : null);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!search.trim()) return;
    setBusy("search");
    try {
      const { results: found } = await postJson<{ results?: TmdbSearchResult[] }>("/api/admin/tmdb", { action: "search", contentKind: kind, query: search.trim() });
      setResults(found ?? []);
      if (!found?.length) toast("TMDB no devolvió resultados para esa búsqueda.", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo buscar en TMDB.", "error");
    } finally {
      setBusy("");
    }
  }

  async function act(action: "link" | "refresh" | "unlink", tmdbId?: number) {
    if (action === "unlink" && !(await confirmDialog({ body: "Se elimina la asociación y la caché de TMDB. El contenido interno no se toca.", confirmLabel: "Desvincular", danger: true, title: "¿Desvincular TMDB?" }))) return;
    setBusy(action);
    try {
      await postJson("/api/admin/tmdb", { action, contentId: selectionId, contentKind: kind, tmdbId });
      setResults(null);
      setSearch("");
      await onChanged();
      toast(action === "unlink" ? "TMDB desvinculado." : action === "link" ? "Metadatos vinculados." : "Caché de TMDB actualizada.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo actualizar TMDB.", "error");
    } finally {
      setBusy("");
    }
  }

  async function syncEpisodes() {
    if (!metadata?.tmdb_id || !episodes.length) return;
    const rawSeasons = metadata.raw_payload?.seasons;
    if (!Array.isArray(rawSeasons)) {
      toast("No encuentro el mapa de temporadas TMDB. Refresca primero los metadatos de la serie.", "error");
      return;
    }
    const tmdbSeasons = rawSeasons.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const season = value as Record<string, unknown>;
      return typeof season.season_number === "number" && typeof season.episode_count === "number"
        ? [{ season_number: season.season_number, episode_count: season.episode_count }]
        : [];
    });
    const localSeasonNumbers = new Map(seasons.map((season) => [season.id, season.season_number ?? 0]));
    const orderedEpisodes = [...episodes].sort((left, right) =>
      (localSeasonNumbers.get(left.season_id ?? "") ?? 0) - (localSeasonNumbers.get(right.season_id ?? "") ?? 0)
      || (left.episode_number ?? 0) - (right.episode_number ?? 0));
    let regularOrdinal = 0;
    const mappedEpisodes = orderedEpisodes.map((episode) => {
      const localSeason = localSeasonNumbers.get(episode.season_id ?? "") ?? 0;
      if (localSeason === 0) {
        return { episode, coordinates: { seasonNumber: 0, episodeNumber: episode.episode_number ?? 0 } };
      }
      regularOrdinal += 1;
      return { episode, coordinates: mapEpisodeOrdinalToTmdb(regularOrdinal, tmdbSeasons) };
    });

    setBusy("episodes");
    setEpisodeProgress({ done: 0, total: mappedEpisodes.length });
    let synced = 0;
    let withoutImage = 0;
    const errors: string[] = [];
    try {
      for (let offset = 0; offset < mappedEpisodes.length; offset += 3) {
        const batch = mappedEpisodes.slice(offset, offset + 3);
        await Promise.all(batch.map(async ({ coordinates, episode }) => {
          if (!coordinates) {
            errors.push(episode.internal_code + ": no existe un episodio correspondiente en las temporadas TMDB.");
            return;
          }
          try {
            const result = await postJson<{ metadata?: { backdrop_path: string | null; poster_path: string | null } }>("/api/admin/tmdb", {
              action: "link", contentId: episode.id, contentKind: "episode",
              tmdbEpisodeNumber: coordinates.episodeNumber, tmdbSeasonNumber: coordinates.seasonNumber,
            });
            synced += 1;
            if (!result.metadata?.backdrop_path && !result.metadata?.poster_path) withoutImage += 1;
          } catch (error) {
            errors.push(episode.internal_code + ": " + (error instanceof Error ? error.message : "error desconocido"));
          }
        }));
        setEpisodeProgress({ done: Math.min(offset + batch.length, mappedEpisodes.length), total: mappedEpisodes.length });
      }
      await onChanged();
      const summary = synced + "/" + mappedEpisodes.length + " episodios sincronizados"
        + (withoutImage ? "; " + withoutImage + " sin imagen en TMDB" : "")
        + (errors.length ? "; " + errors.length + " con error" : "") + ".";
      toast(errors.length ? summary + " Primer error: " + errors[0] : summary, errors.length ? "warn" : "success", 12_000);
    } finally {
      setBusy("");
      setEpisodeProgress(null);
    }
  }
  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div><p className="kicker">Metadatos</p><h2 className="title-m">TMDB</h2><p>Pósters, sinopsis y géneros se guardan en tu base de datos; los lectores nunca consultan TMDB.</p></div>
        {metadata?.tmdb_url ? <a className="btn btn-ghost btn-sm" href={metadata.tmdb_url} rel="noreferrer" target="_blank">Ver en TMDB</a> : null}
      </div>
      {metadata ? (
        <div className="tmdb-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- CDN de TMDB. */}
          {displayPoster ? <img alt="" src={tmdbImage(displayPoster, "w185")!} /> : <div className="poster-fallback" style={{ width: 110, aspectRatio: "2 / 3", borderRadius: 12 }}>{metadata.localized_title}</div>}
          <div>
            <strong className="title-s">{metadata.localized_title ?? metadata.original_title}</strong>
            <p>{metadata.overview || "Sin sinopsis disponible."}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {metadata.release_date ? <span className="badge">{metadata.release_date.slice(0, 4)}</span> : null}
              {metadata.runtime_minutes !== null ? <span className="badge">{metadata.runtime_minutes} min</span> : null}
              {metadata.genres.slice(0, 3).map((genre) => <span className="badge" key={genre.id}>{genre.name}</span>)}
            </div>
            <p className="subtle" style={{ fontSize: "0.75rem" }}>Caché: {metadata.synced_at ? new Date(metadata.synced_at).toLocaleString() : "sin fecha"}</p>
          </div>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>Todavía no hay datos de TMDB para este título.</p>}

      {canSearch ? (
        <form className="inline-form" onSubmit={(event) => void runSearch(event)} style={{ marginTop: 16 }}>
          <input className="input" onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar ${kind === "movie" ? "película" : "serie"} en TMDB`} value={search} />
          <button className="btn btn-ghost" disabled={Boolean(busy)} type="submit"><Icon name="search" />{busy === "search" ? "Buscando…" : "Buscar"}</button>
        </form>
      ) : null}
      {results?.length ? (
        <div className="tmdb-results">
          {results.map((result) => (
            <button className="tmdb-result" disabled={Boolean(busy)} key={result.id} onClick={() => void act("link", result.id)} title="Vincular este resultado" type="button">
              <MediaPoster posterPath={result.posterPath} sizes="150px" title={result.title ?? result.originalTitle ?? "Sin título"} />
              <strong>{result.title ?? result.originalTitle ?? "Sin título"}</strong>
              <span>{result.releaseDate?.slice(0, 4) ?? "—"}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        {(kind === "season" || kind === "episode") && !metadata ? <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void act("link")} type="button"><Icon name="wand" />Vincular desde la serie</button> : null}
        {metadata ? <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void act("refresh")} type="button"><Icon name="refresh" />{busy === "refresh" ? "Actualizando…" : "Refrescar"}</button> : null}
        {metadata ? <button className="btn btn-danger btn-sm" disabled={Boolean(busy)} onClick={() => void act("unlink")} type="button"><Icon name="trash" />Desvincular</button> : null}
      </div>
      {kind === "series" && metadata?.tmdb_id ? (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          <button className="btn btn-ghost btn-sm" disabled={Boolean(busy) || !episodes.length} onClick={() => void syncEpisodes()} type="button">
            <Icon name="refresh" />{busy === "episodes" ? "Sincronizando episodios " + (episodeProgress?.done ?? 0) + "/" + (episodeProgress?.total ?? episodes.length) + "…" : "Sincronizar episodios TMDB (" + episodes.length + ")"}
          </button>
          {episodeProgress ? <div className="progress-block" role="status"><span className="meter"><span style={{ width: Math.round(episodeProgress.done / episodeProgress.total * 100) + "%" }} /></span><div className="progress-meta"><span>Metadatos, sinopsis e imágenes</span><span className="mono">{episodeProgress.done}/{episodeProgress.total}</span></div></div> : null}
        </div>
      ) : null}
      <p className="field-hint" style={{ marginTop: 14 }}>Datos e imágenes proporcionados por TMDB. Esta aplicación no está respaldada ni certificada por TMDB.</p>
    </section>
  );
}

function PlaybackPanel({ contentId, kind, onScanned, playbackPackage, sources }: { contentId: string; kind: "episode" | "movie"; onScanned: (entry: PlaybackPackage) => void; playbackPackage?: PlaybackPackage; sources: PlaybackSource[] }) {
  const [busy, setBusy] = useState(false);
  const active = sources.filter((source) => source.is_active);

  async function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await postJson<{ packageId?: string; scannedAssets?: number; status?: PlaybackPackage["status"] }>("/api/drive-token/media-playback", { action: "scan", contentId, contentKind: kind, driveRootFolderId: form.get("driveRootFolderId"), sourceId: form.get("sourceId") });
      if (!result.packageId || !result.status) throw new Error("No se pudo escanear el paquete HLS.");
      onScanned({ drive_root_folder_id: String(form.get("driveRootFolderId")), episode_id: kind === "episode" ? contentId : null, id: result.packageId, last_error: null, movie_id: kind === "movie" ? contentId : null, source_id: String(form.get("sourceId")), status: result.status });
      toast(`Paquete HLS registrado: ${result.scannedAssets ?? 0} archivos.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo escanear el paquete HLS.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel panel-pad">
      <div className="panel-head">
        <div><p className="kicker">Reproducción</p><h2 className="title-m">Paquete HLS en Drive</h2><p>Carpeta con <code>master.m3u8</code>, listas de vídeo/audio y subtítulos. El escaneo registra los archivos sin exponer enlaces.</p></div>
        {playbackPackage ? <span className={packageBadge[playbackPackage.status]}>{packageLabel[playbackPackage.status]}</span> : <span className="badge">Sin paquete</span>}
      </div>
      {playbackPackage?.last_error ? <div className="notice notice-error" style={{ marginBottom: 14 }}><span className="notice-icon"><Icon name="warning" /></span><div>{playbackPackage.last_error}</div></div> : null}
      {active.length ? (
        <form className="form-grid" onSubmit={(event) => void scan(event)}>
          <label className="field"><span className="field-label">Fuente</span><select className="select" defaultValue={playbackPackage?.source_id ?? active[0]?.id} name="sourceId" required>{active.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
          <label className="field"><span className="field-label">ID de carpeta del paquete</span><input className="input mono" defaultValue={playbackPackage?.drive_root_folder_id ?? ""} name="driveRootFolderId" placeholder="1AbC…" required /></label>
          <div className="span-2"><button className="btn btn-primary" disabled={busy} type="submit"><Icon name="refresh" />{busy ? "Escaneando…" : playbackPackage ? "Reescanear" : "Vincular y escanear"}</button></div>
        </form>
      ) : <div className="notice notice-warn"><span className="notice-icon"><Icon name="info" /></span><div>Primero crea una fuente de Drive en la pestaña <strong>Fuentes de Drive</strong>.</div></div>}
    </section>
  );
}

function SourcesPanel({ onCreated, onSynced, sources }: { onCreated: (source: PlaybackSource) => void; onSynced: () => Promise<void>; sources: PlaybackSource[] }) {
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{ assets: number; packages: number } | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy("create");
    try {
      const { source } = await postJson<{ source?: PlaybackSource }>("/api/drive-token/media-playback", { action: "create-source", driveRootFolderId: form.get("driveRootFolderId"), name: form.get("name") });
      if (!source) throw new Error("No se pudo guardar la fuente.");
      onCreated(source);
      formElement.reset();
      toast("Fuente de Drive guardada.", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudo guardar la fuente.", "error");
    } finally {
      setBusy("");
    }
  }

  async function syncPending(sourceId: string) {
    setBusy(`sync:${sourceId}`);
    setProgress({ assets: 0, packages: 0 });
    let packages = 0; let assets = 0; let remaining = 0; let failures = 0; let missing = 0; let duplicates = 0;
    try {
      do {
        const result = await postJson<{ duplicateCodes?: string[]; errors?: unknown[]; missingContentCodes?: string[]; remaining?: number; scanned?: Array<{ assets: number }> }>("/api/admin/media-playback/batch", { sourceId });
        const scanned = result.scanned ?? [];
        packages += scanned.length;
        assets += scanned.reduce((total, item) => total + item.assets, 0);
        failures += result.errors?.length ?? 0;
        missing = result.missingContentCodes?.length ?? 0;
        duplicates = result.duplicateCodes?.length ?? 0;
        remaining = result.remaining ?? 0;
        setProgress({ assets, packages });
        if (!scanned.length) break;
      } while (remaining > 0);
      await onSynced();
      const notes = [failures ? `${failures} con error` : "", missing ? `${missing} sin contenido registrado` : "", duplicates ? `${duplicates} códigos duplicados` : ""].filter(Boolean);
      toast(`Sincronizados ${packages} paquetes y ${assets} archivos.${notes.length ? ` Revisión: ${notes.join(", ")}.` : ""}`, notes.length ? "warn" : "success", 8000);
    } catch (error) {
      toast(error instanceof Error ? error.message : "No se pudieron sincronizar los paquetes.", "error");
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  return (
    <div className="ops-grid">
      <section className="panel panel-pad">
        <div className="panel-head"><div><p className="kicker">Fuentes</p><h2 className="title-m">Carpetas raíz de Drive</h2><p>Cada fuente apunta a la carpeta que contiene los paquetes <span className="mono">MOV-…</span> y <span className="mono">SER-…</span>.</p></div></div>
        <div style={{ display: "grid", gap: 10 }}>
          {sources.map((source) => (
            <div className="progress-block" key={source.id}>
              <div className="progress-meta">
                <strong style={{ color: "var(--ink)" }}>{source.name}</strong>
                <span className={source.is_active ? "badge badge-mint badge-dot" : "badge"}>{source.is_active ? "Activa" : "Inactiva"}</span>
              </div>
              <span className="mono subtle" style={{ fontSize: "0.74rem", overflowWrap: "anywhere" }}>{source.drive_root_folder_id}</span>
              <button className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void syncPending(source.id)} style={{ width: "fit-content" }} type="button"><Icon name="refresh" />{busy === `sync:${source.id}` ? "Sincronizando…" : "Sincronizar paquetes pendientes"}</button>
              {busy === `sync:${source.id}` && progress ? <span className="field-hint">{progress.packages} paquetes · {progress.assets} archivos registrados…</span> : null}
            </div>
          ))}
          {!sources.length ? <p className="muted" style={{ margin: 0 }}>Aún no hay fuentes configuradas.</p> : null}
        </div>
      </section>
      <section className="panel panel-pad">
        <div className="panel-head"><div><p className="kicker">Nueva fuente</p><h2 className="title-m">Añadir carpeta de Drive</h2></div></div>
        <form onSubmit={(event) => void create(event)} style={{ display: "grid", gap: 14 }}>
          <label className="field"><span className="field-label">Nombre</span><input className="input" name="name" placeholder="Biblioteca de entretenimiento" required /></label>
          <label className="field"><span className="field-label">ID de carpeta raíz</span><input className="input mono" name="driveRootFolderId" placeholder="1AbC…" required /><span className="field-hint">Está en la URL de la carpeta: drive.google.com/drive/folders/<strong>ID</strong></span></label>
          <button className="btn btn-primary" disabled={Boolean(busy)} style={{ width: "fit-content" }} type="submit"><Icon name="plus" />{busy === "create" ? "Guardando…" : "Guardar fuente"}</button>
        </form>
      </section>
    </div>
  );
}
