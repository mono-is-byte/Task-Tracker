"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { describeDevice, sessionStatus, timeAgo, timeUntil } from "@/lib/sessionInfo";

interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  /** Last request that used the session (persisted idle deadline − idle TTL). */
  lastActiveAt: string;
  rememberMe: boolean;
  ip: string | null;
  userAgent: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ProfilePage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [meId, setMeId] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");
  const [sessionsMsg, setSessionsMsg] = useState("");
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionInfo | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  /** Ticks every 30s so "2 minutes ago" / "in 11 hours" never go stale. */
  const [clock, setClock] = useState(() => new Date());
  const [msg, setMsg] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  // Self-service email change (reauthenticated with the current password).
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailNotice, setEmailNotice] = useState("");

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.ok) {
        const j = await r.json();
        setName(j.data.user.name);
        setEmail(j.data.user.email);
        setAvatarUrl(j.data.user.avatarUrl ?? null);
        setMeId(j.data.user.id);
      }
    });
    void loadSessions();
    const tick = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Active sessions always reload from the server — never optimistically faked. */
  async function loadSessions() {
    setSessionsError("");
    try {
      const res = await fetch("/api/auth/sessions");
      if (!res.ok) throw new Error("Could not load your sessions.");
      const j = await res.json();
      setSessions(j.data.sessions);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "Could not load your sessions.");
    } finally {
      setSessionsLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setMsg(res.ok ? "Profile saved." : "Could not save profile.");
  }

  function startEmailEdit() {
    setEmailError("");
    setEmailNotice("");
    setNewEmail("");
    setEmailPassword("");
    setEditingEmail(true);
  }

  function cancelEmailEdit() {
    setEditingEmail(false);
    setNewEmail("");
    setEmailPassword("");
    setEmailError("");
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setEmailNotice("");
    const value = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setEmailError("Enter a valid email address (name@domain).");
      return;
    }
    if (!emailPassword) {
      setEmailError("Enter your current password to confirm the change.");
      return;
    }
    setEmailBusy(true);
    try {
      const res = await fetch("/api/profile/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, password: emailPassword }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setEmailError(j?.error?.message ?? "Could not change the email address.");
        return;
      }
      // Only mirror what the backend actually stored.
      setEmail(j.data.user.email);
      setEditingEmail(false);
      setNewEmail("");
      setEmailPassword("");
      setEmailNotice(`Email changed to ${j.data.user.email}. Use it the next time you sign in.`);
    } catch {
      setEmailError("Network error — the email address was not changed.");
    } finally {
      setEmailBusy(false);
    }
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
    if (res.ok) { setCurrent(""); setNext(""); }
  }

  const others = sessions.filter((s) => !s.current);

  async function revokeSession(id: string) {
    setSessionsBusy(true);
    setSessionsError("");
    setSessionsMsg("");
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? "Could not sign out that session.");
      setSessionsMsg("Session signed out.");
      setRevokeTarget(null);
      await loadSessions();
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "Could not sign out that session.");
      setRevokeTarget(null);
    } finally {
      setSessionsBusy(false);
    }
  }

  async function signOutOthers() {
    setSessionsBusy(true);
    setSessionsError("");
    setSessionsMsg("");
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ others: true }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? "Could not sign out the other sessions.");
      const count = Number(j?.data?.count ?? 0);
      setSessionsMsg(`Signed out ${count} other session${count === 1 ? "" : "s"}.`);
      setConfirmOthers(false);
      await loadSessions();
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "Could not sign out the other sessions.");
      setConfirmOthers(false);
    } finally {
      setSessionsBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-4 text-2xl font-bold">Profile</h1>
      {msg && <p className="mb-3 rounded bg-slate-200 p-2 text-sm dark:bg-slate-800" role="status">{msg}</p>}

      {/* Change request: Profile (left) and Active Sessions (right) sit side by
          side from md up and stack on phones. The grid stretches both cards to
          the same height; the sessions card then keeps its list scrolling
          inside (the md-only wrapper below) instead of growing the page. */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_24rem]">

      {/* ONE card for identity, email and password — sections separated by rules. */}
      <div className="tt-card p-4 md:p-5">
        <form onSubmit={save}>
          {/* Change request: the Name label matches the "Email address" heading
              (same size, weight and spacing). The heading sits in a span so the
              input below keeps the normal input typography. */}
          <label className="mb-3 block">
            <span className="mb-2 block font-semibold">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="tt-input" />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Avatar name={name || "?"} url={avatarUrl} size={40} />
            <label className="tt-btn cursor-pointer">
              Upload avatar (jpg/jpeg, ≤ 2 MB)
              <input type="file" accept=".jpg,.jpeg,image/jpeg" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = ""; }} />
            </label>
            {avatarUrl && (
              <button type="button" onClick={() => void clearAvatar()} className="tt-btn text-red-600 dark:text-red-400">
                Remove
              </button>
            )}
          </div>
          <div className="mt-3">
            <button className="tt-btn-primary">Save profile</button>
          </div>
        </form>

        <div className="mt-4 border-t border-line pt-3">
          <h2 className="mb-2 font-semibold">Email address</h2>
          {emailNotice && (
            <p className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
              {emailNotice}
            </p>
          )}
          {!editingEmail ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm">{email || "—"}</span>
              <button type="button" onClick={startEmailEdit} className="tt-btn">Edit email</button>
            </div>
          ) : (
            <form onSubmit={saveEmail} className="flex flex-col gap-2">
              <label className="text-sm">New email address
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                  className="tt-input mt-1" placeholder="you@example.com" autoComplete="email" />
              </label>
              <label className="text-sm">Current password (confirms it&apos;s you)
                <input type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)}
                  className="tt-input mt-1" placeholder="Current password" autoComplete="current-password" />
              </label>
              {emailError && (
                <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
                  {emailError}
                </p>
              )}
              <p className="text-xs text-muted">
                Your account id, projects, tasks and permissions stay on this account. This deployment has no email
                verification service, so the new address takes effect immediately — no verification email is sent.
              </p>
              <div className="flex gap-2">
                <button type="submit" className="tt-btn-primary" disabled={emailBusy}>
                  {emailBusy ? "Saving…" : "Save email"}
                </button>
                <button type="button" className="tt-btn" onClick={cancelEmailEdit} disabled={emailBusy}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <h2 className="mb-2 font-semibold">Change password</h2>
          <form onSubmit={changePw} className="flex flex-col gap-2">
            <label className="block text-sm">Current password
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
                className="tt-input mt-1" autoComplete="current-password" placeholder="Current password" />
            </label>
            <label className="block text-sm">New password
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
                className="tt-input mt-1" autoComplete="new-password" placeholder="New password" />
            </label>
            <div>
              <button className="tt-btn-primary">Change password</button>
            </div>
          </form>
        </div>
      </div>

      {/* Change request: same outer height as the profile card. The card is a
          flex column, so its intrinsic height contribution is just the header;
          the grid stretches it to the profile card's height and the session
          list fills (and scrolls inside) the rest via the md-only absolute
          wrapper on the list. On phones the list keeps its own max height. */}
      <div className="tt-card relative flex flex-col p-4 md:p-5">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold">Active sessions</h2>
            <p className="text-xs text-muted">
              Every device/browser signed in to your account right now. “Last active” is the most recent request
              that session made to this app — revoking one signs that device out immediately.
            </p>
          </div>
          {others.length > 0 && (
            <button
              type="button"
              className="tt-btn ml-auto text-red-600 dark:text-red-400"
              onClick={() => { setSessionsError(""); setSessionsMsg(""); setConfirmOthers(true); }}
              title="Sign out every session except this one"
            >
              Sign out other sessions ({others.length})
            </button>
          )}
        </div>

        {sessionsMsg && (
          <p className="mt-3 rounded bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
            {sessionsMsg}
          </p>
        )}
        {sessionsError && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {sessionsError}
            <button type="button" onClick={() => void loadSessions()} className="underline underline-offset-2">Retry</button>
          </p>
        )}

        <div className="mt-3 min-h-0 flex-1 md:relative">
          {sessionsLoading ? (
            <p className="text-xs text-muted">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-muted">No active sessions found.</p>
          ) : (
            <ul
              className="scroll-thin flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain pr-1 md:absolute md:inset-0 md:max-h-none"
              role="region"
              aria-label="Active sessions"
              tabIndex={0}
            >
              {sessions.map((s) => {
                const device = describeDevice(s.userAgent);
                const status = sessionStatus(s, clock);
                const endsAt = new Date(Math.min(new Date(s.idleExpiresAt).getTime(), new Date(s.expiresAt).getTime()));
                return (
                  <li key={s.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium" title={s.userAgent ?? "No user agent was recorded at sign-in"}>
                        {device.label}
                      </span>
                      {status === "current" && (
                        <span
                          className="rounded-full border border-accent px-2 py-0.5 text-[11px] font-semibold text-accent"
                          title="The session you are using right now"
                        >
                          Current session
                        </span>
                      )}
                      {status === "active" && (
                        <span
                          className="rounded-full border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                          title="Used within the last 15 minutes"
                        >
                          Active
                        </span>
                      )}
                      {status === "idle" && (
                        <span
                          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted"
                          title="No request in the last 15 minutes — an idle session signs out automatically after 2 hours"
                        >
                          Idle
                        </span>
                      )}
                      {s.rememberMe && (
                        <span
                          className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted"
                          title="Chosen at sign-in: this session survives browser restarts (up to 30 days)"
                        >
                          Remembered device
                        </span>
                      )}
                      {!s.current && (
                        <button
                          type="button"
                          className="tt-btn ml-auto px-2 py-0.5 text-xs hover:text-red-600"
                          onClick={() => { setSessionsError(""); setSessionsMsg(""); setRevokeTarget(s); }}
                          aria-label={`Sign out ${device.label}`}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      <span title={new Date(s.lastActiveAt).toLocaleString()}>
                        Last active: {status === "current" ? "Active now" : timeAgo(s.lastActiveAt, clock)}
                      </span>
                      <span title={new Date(s.createdAt).toLocaleString()}>Signed in: {timeAgo(s.createdAt, clock)}</span>
                      <span title={`Idle timeout: ${new Date(s.idleExpiresAt).toLocaleString()} · Absolute expiry: ${new Date(s.expiresAt).toLocaleString()}`}>
                        Expires: {timeUntil(endsAt, clock)}
                      </span>
                      <span className="font-mono" title="The network address this session signs in from">
                        {s.ip ? `IP ${s.ip}` : "IP not recorded"}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      </div>

      {revokeTarget && (
        <ConfirmDialog
          title="Sign out this session?"
          body={`${describeDevice(revokeTarget.userAgent).label} loses access immediately and must sign in again.`}
          confirmLabel="Sign out"
          busy={sessionsBusy}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={() => void revokeSession(revokeTarget.id)}
        />
      )}

      {confirmOthers && (
        <ConfirmDialog
          title={`Sign out ${others.length} other session${others.length === 1 ? "" : "s"}?`}
          body="Every device except this one is signed out immediately and must sign in again."
          confirmLabel="Sign out others"
          busy={sessionsBusy}
          onCancel={() => setConfirmOthers(false)}
          onConfirm={() => void signOutOthers()}
        />
      )}
    </div>
  );
}
