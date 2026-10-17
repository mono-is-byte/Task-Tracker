"use client";

import { useState } from "react";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [done, setDone] = useState(false);
  const [adminReset, setAdminReset] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const json = await res.json();
      setDone(true);
      setAdminReset(Boolean(json.data?.adminReset));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow dark:bg-slate-900">
        <h1 className="text-xl font-bold">Forgot password</h1>
        {done ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {adminReset
              ? "This server does not send email. Ask an administrator to reset your password from Admin → Users."
              : "If the account exists, a reset link was issued. Check with your administrator."}
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">Enter your email or username.</p>
            <input
              className="mb-4 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800"
              value={identifier} onChange={(e) => setIdentifier(e.target.value)} required
            />
            <button type="submit" disabled={busy} className="w-full rounded bg-indigo-600 p-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Sending…" : "Request reset"}
            </button>
          </>
        )}
        <a href="/login" className="mt-3 block text-center text-sm text-indigo-600 dark:text-indigo-400">Back to login</a>
      </form>
    </div>
  );
}
