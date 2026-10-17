"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, rememberMe }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Login failed.");
        return;
      }
      if (json.data.user.mustChangePassword) {
        router.push("/change-password");
      } else {
        router.push(next);
      }
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
        <h1 className="text-2xl font-bold">TaskTracker</h1>
        <p className="mb-4 text-sm text-slate-500">Sign in to continue</p>
        {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
        <label className="mb-2 block text-sm">
          Email or username
          <input
            className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800"
            value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required
          />
        </label>
        <label className="mb-2 block text-sm">
          Password
          <input
            type="password"
            className="mt-1 w-full rounded border p-2 dark:border-slate-700 dark:bg-slate-800"
            value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required
          />
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          Remember me (30 days)
        </label>
        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-indigo-600 p-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Login"}
        </button>
        <a href="/forgot-password" className="mt-3 block text-center text-sm text-indigo-600 dark:text-indigo-400">
          Forgot password?
        </a>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
