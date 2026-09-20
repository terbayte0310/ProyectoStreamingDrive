import type { CSSProperties } from "react";

export default function ClassroomLoading() {
  return (
    <div aria-busy="true" className="shell">
      <div className="site-header"><div className="site-header-inner"><div className="skeleton" style={{ width: 130, height: 30, borderRadius: 99 }} /></div></div>
      <main className="shell-main container">
        <div className="classroom">
          <div className="classroom-stage">
            <div className="skeleton" style={{ width: "min(420px, 80%)", height: 34 }} />
            <div className="nplayer" data-status="loading">
              <div className="np-overlay" role="status">
                <span className="orbit-loader" style={{ "--size": "56px" } as CSSProperties}><span /></span>
                <span className="np-stage-label">Abriendo el aula…</span>
              </div>
            </div>
          </div>
          <aside className="playlist" style={{ padding: 12, gap: 8, display: "grid" }}>
            {Array.from({ length: 9 }, (_, index) => <div className="skeleton" key={index} style={{ height: 44, opacity: 1 - index * 0.09 }} />)}
          </aside>
        </div>
      </main>
    </div>
  );
}
