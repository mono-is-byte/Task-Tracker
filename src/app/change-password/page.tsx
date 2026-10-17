"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Could not change password.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow dark:bg-slate-900">
        <h1 className="text-xl font-bold">Set a new password</h1>
        <p className="mb-4 text-sm text-slate-500">
          Your account uses a temporary password. Choose a new one (min 8 chars, upper + lower + digit).
        </p>
        {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
        <label className="mb-2 block text-sm">
          Current (temporary) password
          <input type="password" className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800"
            value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="mb-2 block text-sm">
          New password
          <input type="password" className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800"
            value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </label>
        <label className="mb-4 block text-sm">
          Confirm new password
          <input type="password" className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        <button type="submit" disabled={busy} className="w-full rounded bg-indigo-600 p-2 font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
