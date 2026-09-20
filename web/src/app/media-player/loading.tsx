import type { CSSProperties } from "react";

export default function WatchLoading() {
  return (
    <main aria-busy="true" className="watch-page">
      <div className="watch-stage">
        <div className="nplayer" data-status="loading">
          <div className="np-overlay" role="status">
            <span className="orbit-loader" style={{ "--size": "64px" } as CSSProperties}><span /></span>
            <span className="np-stage-label">Preparando la sala…</span>
          </div>
        </div>
      </div>
    </main>
  );
}
