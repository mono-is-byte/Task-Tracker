"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

export interface Lookups {
  project: {
    id: string; key: string; name: string; description: string | null;
    hoursPerDay: number; workingDays: number[]; pointScale: number[];
    bannerNote: string | null; settings: Record<string, unknown>; isHidden: boolean;
  };
  membership: {
    userId: string; roleIds: string[]; roleNames: string[]; roleName: string;
    perms: Record<string, boolean>; fieldRules: Record<string, string>; isSuperAdmin: boolean;
  };
  statuses: { id: string; name: string; category: string; color: string; position: number; designationTags: string[] }[];
  priorities: { id: string; name: string; level: number; color: string }[];
  issueTypes: { id: string; name: string; color: string }[];
  /** Every valid (non-deleted) user — assignee/tester pickers show the whole
   *  list; `isMember` marks project members, `active` is false for deactivated
   *  (but not deleted) accounts. */
  members: { userId: string; name: string; username: string; designationName: string | null; avatarUrl: string | null; active: boolean; isMember: boolean; roleIds: string[]; roleNames: string[]; roleName: string; hoursPerDay: number | null }[];
  epics: { id: string; name: string; color: string; status: string }[];
  customFields: { id: string; name: string; fieldType: string; options: string[]; required: boolean; showIn: string[]; roleVisibility: Record<string, string> }[];
}

export function useProject(projectId: string) {
  const [data, setData] = useState<Lookups | null>(null);
  const [error, setError] = useState("");
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => {
    let alive = true;
    api<Lookups>(`/api/projects/${projectId}/lookups`)
      .then((d) => { if (alive) { setData(d); setError(""); } })
      .catch((e: Error & { status?: number }) => {
        if (alive) {
          if (e.status === 403) window.location.href = "/no-access";
          else setError(e.message);
        }
      });
    return () => { alive = false; };
  }, [projectId, rev]);

  // Live configuration (change request): statuses/priorities/issue types are
  // rendered from these lookups by the drawer, table, board and filters — so an
  // edit in project Settings reaches every open page. Only lookup-affecting
  // events refetch (task/timer traffic is handled by the shared task store) and
  // bursts are debounced; a focus refresh covers the SSE-unavailable case.
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setRev((r) => r + 1);
      }, 300);
    };
    try {
      es = new EventSource(`/api/projects/${projectId}/events`);
      es.onmessage = (e) => {
        try {
          const evt = JSON.parse(e.data) as { type?: string };
          if (evt.type === "workflow_changed" || evt.type === "fields_changed" || evt.type === "project_changed") {
            schedule();
          }
        } catch { /* non-JSON keep-alive frame */ }
      };
      es.onerror = () => { es?.close(); es = null; };
    } catch { /* EventSource unavailable — focus refresh still applies */ }
    window.addEventListener("focus", schedule);
    return () => {
      es?.close();
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", schedule);
    };
  }, [projectId]);

  return { data, error, refresh };
}

/** Subscribe to project SSE; falls back to polling every 15s. Returns a tick counter. */
export function useLive(projectId: string, onEvent?: () => void): number {
  const [tick, setTick] = useState(0);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const fire = () => {
      if (stopped) return;
      setTick((t) => t + 1);
      cb.current?.();
    };
    try {
      es = new EventSource(`/api/projects/${projectId}/events`);
      es.onmessage = fire;
      es.onerror = () => {
        // SSE failed → polling fallback
        es?.close();
        es = null;
        if (!poll && !stopped) poll = setInterval(fire, 15000);
      };
    } catch {
      poll = setInterval(fire, 15000);
    }
    return () => {
      stopped = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [projectId]);

  return tick;
}
