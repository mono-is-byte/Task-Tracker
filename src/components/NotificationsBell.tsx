"use client";

import { useEffect, useState } from "react";

interface Note {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export default function NotificationsBell() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
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

  async function markAll() {
    await fetch("/api/notifications", { method: "POST" });
    setNotes((ns) => ns.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded px-2 py-1 text-sm hover:bg-slate-200 dark:hover:bg-slate-800"
        title="Notifications"
      >
        🔔{unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-72 overflow-auto rounded border bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
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
        </div>
      )}
    </div>
  );
}
