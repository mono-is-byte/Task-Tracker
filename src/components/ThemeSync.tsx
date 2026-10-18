"use client";

import { useEffect, useLayoutEffect } from "react";

// Before paint on the client; plain effect during SSR, where useLayoutEffect warns.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Device choice first (same order as the root layout's no-FOUC inline script). */
function deviceTheme(): "light" | "dark" | null {
  try {
    const stored = localStorage.getItem("tt_theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage can be unavailable (private mode) — fall through to the cookie */
  }
  const match = document.cookie.match(/(?:^|;\s*)tt_theme=(light|dark)/);
  return match ? (match[1] as "light" | "dark") : null;
}

/**
 * Theme precedence: device choice (localStorage / `tt_theme` cookie) > saved
 * profile preference > system default.
 *
 * The root layout's inline script already applied this before paint on a hard
 * load, so this is a no-op there; it matters when the app is entered through a
 * client-side navigation (e.g. right after login, when the login response has
 * just set `tt_theme` from the profile).
 *
 * This replaces the inline <script> the app layout used to render: React never
 * executes script tags rendered inside components on the client, and it logs
 * "Encountered a script tag while rendering React component" for them.
 */
export default function ThemeSync({ profileTheme }: { profileTheme: string }) {
  useBeforePaint(() => {
    const theme =
      deviceTheme() ?? (profileTheme === "light" || profileTheme === "dark" ? profileTheme : null);
    // "system" → leave whatever the OS-driven default already set.
    if (theme) document.documentElement.classList.toggle("dark", theme === "dark");
  }, [profileTheme]);

  return null;
}
