"use client";

import { useRef, useState } from "react";

import { NebulaPlayer } from "@/components/nebula-player";

/** Reproductor de la vista de diseño: usa un vídeo local de prueba si existe en /public. */
export function PreviewPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [theater, setTheater] = useState(false);
  const [captions, setCaptions] = useState(-1);
  const [quality, setQuality] = useState(-1);
  const [delay, setDelay] = useState(0);
  return (
    <div style={{ maxWidth: theater ? "100%" : 980 }}>
      <NebulaPlayer
        backHref="/design-preview"
        badges={["Vista de diseño"]}
        captionDelay={{ onChange: setDelay, value: delay }}
        captions={{ onChange: setCaptions, options: [{ label: "Español", value: 0 }, { label: "English", value: 1 }], value: captions }}
        onNext={() => undefined}
        onTheaterChange={setTheater}
        preload="metadata"
        quality={{ autoLabel: "720p", onChange: setQuality, options: [{ label: "1080p", value: 2 }, { label: "720p", value: 1 }, { label: "480p", value: 0 }], value: quality }}
        src="/dev-preview.mp4"
        status="ready"
        subtitle="Nébula · Demostración"
        theater={theater}
        title="El arte de observar"
        upNext={{ onPlay: () => undefined, title: "Capítulo 2 · La luz" }}
        videoRef={videoRef}
      />
    </div>
  );
}
