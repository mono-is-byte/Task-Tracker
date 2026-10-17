"use client";

import { useEffect, useState } from "react";

/**
 * Live timer ticking: re-renders every `ms` while `active` (i.e. some timer on
 * the page is running) so running elapsed times count up without a reload.
 * Returns the current Date so the render can recompute durations from the
 * persisted stageEnteredAt/totalSeconds columns — never from client state.
 */
export function useTicker(active: boolean, ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}
