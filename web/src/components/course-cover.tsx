import type { CSSProperties } from "react";

const palettes = [
  ["#075dff", "#70ddff", "#d8ecff"],
  ["#143dff", "#8c7dff", "#e7e4ff"],
  ["#006eb8", "#12c2e9", "#d8f9ff"],
  ["#0055cc", "#4d9fff", "#b9dcff"],
  ["#1744a5", "#00a8ff", "#ebf7ff"],
] as const;

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

function initials(title: string) {
  return title
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "NX";
}

export function CourseCover({
  category,
  coverUrl,
  priority = false,
  title,
}: {
  category: string;
  coverUrl?: string | null;
  priority?: boolean;
  title: string;
}) {
  const seed = hash(`${category}:${title}`);
  const palette = palettes[seed % palettes.length];
  const style = {
    "--cover-a": palette[0],
    "--cover-b": palette[1],
    "--cover-c": palette[2],
  } as CSSProperties;

  return (
    <div className="course-cover" style={style}>
      {coverUrl ? (
        // URLs de portada son datos administrados; lazy-loading evita trabajo fuera de pantalla.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" decoding="async" fetchPriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} src={coverUrl} />
      ) : (
        <>
          <span aria-hidden="true" className="cover-orbit cover-orbit-one" />
          <span aria-hidden="true" className="cover-orbit cover-orbit-two" />
          <span aria-hidden="true" className="cover-grid" />
          <span aria-hidden="true" className="cover-monogram">{initials(title)}</span>
        </>
      )}
      <span className="cover-scrim" />
      <span className="cover-category">{category}</span>
    </div>
  );
}
