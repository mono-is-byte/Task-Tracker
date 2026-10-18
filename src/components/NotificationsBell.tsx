"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconBell } from "./icons";

interface Note {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** Panel size — used to keep it inside the viewport next to the collapsed rail. */
const PANEL_W = 288;
const PANEL_MAX_H = 336;

export default function NotificationsBell() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = notes.filter((n) => !n.read).length;

  async function load() {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const json = await res.json();
        setNotes(json.data.notifications);
      }
    } catch { /* offline */ }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  // The panel is portaled to <body> so it is never clipped by the sidebar's
  // own scroll container (that used to cut it off, worst in the icon rail).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8));
      const top = Math.min(r.bottom + 4, Math.max(8, window.innerHeight - PANEL_MAX_H));
      setPos({ top, left });
    }
    setOpen(true);
  }

  async function markAll() {
    await fetch("/api/notifications", { method: "POST" });
    setNotes((ns) => ns.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        className="relative rounded px-1.5 py-1 text-muted transition-colors hover:bg-line hover:text-accent"
        title="Notifications"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
      >
        <IconBell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: PANEL_W }}
          className="z-[70] max-h-80 overflow-auto rounded border border-line bg-surface p-2 shadow-lg"
        >
          <div className="mb-1 flex items-center justify-between">
            <strong className="text-sm">Notifications</strong>
            <button onClick={markAll} className="text-xs text-indigo-600">Mark all read</button>
          </div>
          {notes.length === 0 && <p className="text-xs text-slate-500">No notifications.</p>}
          {notes.map((n) => (
            <a key={n.id} href={n.link ?? "#"} className={`block rounded p-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${n.read ? "opacity-60" : ""}`}>
              <div className="font-semibold">{n.title}</div>
              {n.body && <div className="text-slate-500">{n.body}</div>}
            </a>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
