import type { SVGProps } from "react";

// Un único set de iconos de trazo para que toda la interfaz comparta el mismo peso visual.
const paths = {
  arrowLeft: "M15 18l-6-6 6-6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  course: "M3 7.5L12 4l9 3.5-9 3.5-9-3.5zM7 9.5v5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5M21 7.5V13",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a18 18 0 01-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 100-18 9 9 0 000 18z",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  minimize: "M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5",
  note: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5",
  pause: "M8 5v14M16 5v14",
  pip: "M21 11V5H3v14h7M13 13h8v7h-8z",
  play: "M7 4.5v15l12.5-7.5z",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  skipBack: "M11.5 8.5L7 12l4.5 3.5M17.5 8.5L13 12l4.5 3.5",
  skipNext: "M5 5l10 7-10 7zM19 5v14",
  skipPrev: "M19 5L9 12l10 7zM5 5v14",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  subtitles: "M3 5h18v14H3zM7 11h4M13 11h4M7 15h7M16 15h1",
  theater: "M2 6h20v12H2zM6 18v2M18 18v2",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  tv: "M3 6h18v12H3zM8 21h8M9 3l3 3 3-3",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-6 8-6s8 2 8 6",
  volume: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12",
  volumeLow: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 010 7",
  volumeMute: "M4 9v6h4l5 4V5L8 9zM17 9.5l5 5M22 9.5l-5 5",
  warning: "M12 4l9 16H3zM12 10v4M12 17h.01",
  wand: "M4 20L15 9M14 4v2M19 9h2M17.5 5.5l1.5-1.5M12 3l.5 1.5M20 12l-1.5.5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const filled = name === "play";
  return (
    <svg aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={filled ? 0 : strokeWidth} viewBox="0 0 24 24" {...props}>
      <path d={paths[name]} />
    </svg>
  );
}
