"use client";

import { useEffect, useState } from "react";

function currentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  // null until the effect runs → server and first client render match (no hydration mismatch)
  const [theme, setThemeState] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setThemeState(currentTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key === "tt_theme" && (e.newValue === "light" || e.newValue === "dark")) {
        document.documentElement.classList.toggle("dark", e.newValue === "dark");
        setThemeState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function setTheme(mode: "light" | "dark") {
    document.documentElement.classList.toggle("dark", mode === "dark");
    setThemeState(mode);
    // localStorage = device choice (read by the no-FOUC inline script first),
    // cookie = server-visible fallback, profile PATCH = cross-device preference
    localStorage.setItem("tt_theme", mode);
    document.cookie = `tt_theme=${mode}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: mode }),
    }).catch(() => {});
  }

  const btn = (mode: "light" | "dark", icon: string, label: string) => (
    <button
      onClick={() => setTheme(mode)}
      title={`${label} theme`}
      aria-label={`${label} theme`}
      aria-pressed={theme === mode}
      className={`tt-btn border-0 rounded-none ${theme === mode ? `bg-accent ${mode === "dark" ? "text-slate-950" : "text-white"}` : ""}`}
    >
      {icon}
    </button>
  );

  return (
    <span className="inline-flex overflow-hidden rounded border border-line" role="group" aria-label="Theme">
      {btn("light", "☀", "Light")}
      {btn("dark", "🌙", "Dark")}
    </span>
  );
}
