"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";

interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  rememberMe: boolean;
  ip: string | null;
  userAgent: string | null;
}

export default function ProfilePage() {
  const [name, setName] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [meId, setMeId] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [msg, setMsg] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.ok) {
        const j = await r.json();
        setName(j.data.user.name);
        setHoursPerDay(j.data.user.hoursPerDay?.toString() ?? "");
        setAvatarUrl(j.data.user.avatarUrl ?? null);
        setMeId(j.data.user.id);
      }
    });
    fetch("/api/auth/sessions").then(async (r) => {
      if (r.ok) setSessions((await r.json()).data.sessions);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, hoursPerDay: hoursPerDay === "" ? null : Number(hoursPerDay) }),
    });
    setMsg(res.ok ? "Profile saved." : "Could not save profile.");
  }

  async function uploadAvatar(file: File) {
    setMsg("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/users/${meId}/avatar`, { method: "POST", body: fd });
    const j = await res.json();
    if (res.ok) { setAvatarUrl(j.data.avatarUrl); setMsg("Avatar updated."); }
    else setMsg(j.error?.message ?? "Upload failed.");
  }

  async function clearAvatar() {
    setMsg("");
    const res = await fetch(`/api/users/${meId}/avatar`, { method: "DELETE" });
    if (res.ok) { setAvatarUrl(null); setMsg("Avatar removed."); }
    else setMsg("Could not remove the avatar.");
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const j = await res.json();
    setMsg(res.ok ? "Password changed." : (j.error?.message ?? "Failed."));
  }

  async function revoke(id: string) {
    await fetch("/api/auth/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id }),
    });
    setSessions((ss) => ss.filter((s) => s.id !== id));
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-2xl font-bold">Profile</h1>
      {msg && <p className="mb-3 rounded bg-slate-200 p-2 text-sm dark:bg-slate-800">{msg}</p>}
      <form onSubmit={save} className="tt-card mb-6 p-4">
        <label className="mb-2 block text-sm">Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Avatar name={name || "?"} url={avatarUrl} size={40} />
          <label className="cursor-pointer rounded border px-2 py-1 text-xs dark:border-slate-700">
            Upload avatar (jpg/jpeg, ≤ 2 MB)
            <input type="file" accept=".jpg,.jpeg,image/jpeg" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = ""; }} />
          </label>
          {avatarUrl && (
            <button type="button" onClick={() => void clearAvatar()} className="rounded border px-2 py-1 text-xs text-red-600 dark:border-slate-700 dark:text-red-400">
              Remove
            </button>
          )}
        </div>
        <label className="mb-3 block text-sm">My working hours/day (capacity override)
          <input value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} type="number" min={1} max={24} step={0.5} placeholder="project default"
            className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <button className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">Save profile</button>
      </form>

      <form onSubmit={changePw} className="tt-card mb-6 p-4">
        <h2 className="mb-2 font-semibold">Change password</h2>
        <input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)}
          className="mb-2 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800" />
        <input type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)}
          className="mb-2 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800" />
        <button className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white">Change password</button>
      </form>

      <div className="tt-card p-4">
        <h2 className="mb-2 font-semibold">Active sessions</h2>
        <ul className="flex flex-col gap-1 text-xs">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded bg-slate-50 p-2 dark:bg-slate-800">
              <span className="flex-1 truncate">{s.userAgent ?? "unknown device"} · {s.ip ?? ""} {s.current && "(this device)"}</span>
              {!s.current && <button onClick={() => revoke(s.id)} className="rounded border px-2 py-0.5">Revoke</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
