import type { CSSProperties } from "react";

const palettes = [
  ["#34452a", "#6c823e", "#d9ed8d"],
  ["#413c4a", "#83708c", "#d6c1d8"],
  ["#214644", "#408f85", "#b2e3ce"],
  ["#493f32", "#9d8058", "#eed3a0"],
  ["#283d38", "#658f75", "#c9e7bc"],
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
