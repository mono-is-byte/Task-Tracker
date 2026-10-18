"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "./icons";

function currentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The single light/dark switch (sidebar footer).
 *
 *  - One button, 28×28, that flips to the OPPOSITE mode: it shows a moon in
 *    light mode ("Switch to dark mode") and a sun in dark mode ("Switch to
 *    light mode"), both with a tooltip + accessible label.
 *  - Which glyph is visible is decided by CSS from the <html class="dark"> the
 *    root layout sets before paint, so the correct icon is there on the very
 *    first frame (no flash, no wrong icon while hydrating). The label follows
 *    the same precedence via state, refreshed after mount.
 *  - The click target is read from the live DOM, so the button is correct even
 *    before hydration has finished.
 *  - Switching keeps the existing precedence: localStorage = device choice
 *    (read first by the no-FOUC inline script), cookie = server-visible
 *    fallback, profile PATCH = cross-device preference.
 */
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

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={() => setTheme(currentTheme() === "dark" ? "light" : "dark")}
      title={label}
      aria-label={label}
      className="tt-btn h-7 w-7 shrink-0 justify-center p-0 transition duration-150 hover:text-accent active:scale-95"
    >
      {/* Both glyphs are rendered; CSS shows the one matching the current mode. */}
      <IconMoon className="h-4 w-4 text-slate-600 dark:hidden" />
      <IconSun className="hidden h-4 w-4 text-amber-500 dark:block" />
    </button>
  );
}
