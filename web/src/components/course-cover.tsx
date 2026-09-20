import type { CSSProperties } from "react";

// Paletas de "luz de sala": cada curso sin portada recibe una composición estable.
const palettes = [
  ["#3a1d2e", "#ff6a3d", "#ffc59e"],
  ["#1e1c3f", "#7b61ff", "#c9bdff"],
  ["#12302c", "#20b38a", "#aef0d5"],
  ["#3b2413", "#f6a23b", "#ffe1a8"],
  ["#2d1330", "#ff3d7f", "#ffb3cc"],
  ["#10263a", "#3aa0ff", "#b5deff"],
] as const;

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

export function initialsOf(title: string) {
  return title.split(/\s+/).filter((word) => word.length > 2).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "NB";
}

export function CourseCover({ category, className = "", coverUrl, priority = false, showLabel = true, title }: { category: string; className?: string; coverUrl?: string | null; priority?: boolean; showLabel?: boolean; title: string }) {
  const seed = hash(`${category}:${title}`);
  const palette = palettes[seed % palettes.length];
  const style = {
    "--c1": palette[0],
    "--c2": palette[1],
    "--c3": palette[2],
    "--cx": `${55 + (seed % 40)}%`,
    "--cy": `${5 + ((seed >> 3) % 30)}%`,
  } as CSSProperties;

  return (
    <div className={`course-cover ${className}`} style={style}>
      {coverUrl ? (
        // Las portadas son URLs administradas; carga diferida fuera de pantalla.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" decoding="async" fetchPriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} src={coverUrl} />
      ) : (
        <>
          <span aria-hidden="true" className="cover-rings" />
          <span aria-hidden="true" className="cover-glyph">{initialsOf(title)}</span>
        </>
      )}
      {showLabel && category ? <span className="cover-label"><span className="badge">{category}</span></span> : null}
    </div>
  );
}
