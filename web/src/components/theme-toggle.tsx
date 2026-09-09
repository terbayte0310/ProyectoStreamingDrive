"use client";

export function ThemeToggle() {
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("nebula-theme", next);
  }

  return (
    <button
      aria-label="Cambiar tema de color"
      className="icon-button theme-toggle"
      onClick={toggleTheme}
      title="Cambiar tema"
      type="button"
    >
      <span aria-hidden="true" className="theme-light-icon">☾</span>
      <span aria-hidden="true" className="theme-dark-icon">☀</span>
    </button>
  );
}
