"use client";

export function ThemeToggle({ bilingual = false }: { bilingual?: boolean }) {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("signalweb-theme", next);
    } catch {
      /* storage can be disabled; the session still switches */
    }
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={bilingual ? "切换深浅色 / Toggle color theme" : "切换深浅色"}>
      <span className="theme-toggle__to-dark">{bilingual ? "深色 / Dark" : "深色"}</span>
      <span className="theme-toggle__to-light">{bilingual ? "浅色 / Light" : "浅色"}</span>
    </button>
  );
}

