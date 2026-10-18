"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconAlertCircle, IconCheckCircle, IconEye, IconEyeOff, IconListChecks, IconLock } from "@/components/icons";

/**
 * Login — same authentication flow as before (`POST /api/auth/login`,
 * mustChangePassword redirect, `?next=` support); only the presentation is
 * modernised: split brand/form layout, inline validation, a password
 * visibility toggle, a busy state that blocks double submits and one shared
 * design-system palette. Works on mobile (the brand panel collapses to a
 * compact header).
 */

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password, rememberMe }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message ?? `Login failed (${res.status}).`);
        return;
      }
      if (json.data.user.mustChangePassword) {
        router.push("/change-password");
      } else {
        router.push(next);
      }
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-xl md:grid-cols-2">
        {/* Brand panel — hidden on small screens, full panel from md up. */}
        <div className="hidden flex-col justify-between bg-accent p-8 text-white md:flex dark:bg-indigo-950">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 text-lg font-bold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                <IconListChecks className="h-5 w-5" />
              </span>
              TaskTracker
            </div>
            <h2 className="text-2xl font-bold leading-snug">Plan, track and finish your team&apos;s work.</h2>
            <ul className="mt-6 space-y-2 text-sm text-white/85">
              <li className="flex items-center gap-2"><IconCheckCircle className="h-4 w-4 shrink-0" /> Board, table, timeline and calendar in one place</li>
              <li className="flex items-center gap-2"><IconCheckCircle className="h-4 w-4 shrink-0" /> Working-hour timers and workload capacity</li>
              <li className="flex items-center gap-2"><IconCheckCircle className="h-4 w-4 shrink-0" /> Roles, permissions and a full audit trail</li>
            </ul>
          </div>
          <p className="text-xs text-white/70">Sign in with the account your administrator created for you.</p>
        </div>

        {/* Form panel */}
        <div className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-2 md:hidden">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <IconListChecks className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold">TaskTracker</span>
          </div>

          <h1 className="text-xl font-bold tracking-tight">Sign in</h1>
          <p className="mb-5 text-sm text-muted">Welcome back — enter your details to continue.</p>

          {error && (
            <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
              <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <form onSubmit={submit} noValidate>
            <label className="mb-3 block text-sm font-medium" htmlFor="login-identifier">
              Email or username
              <input
                id="login-identifier"
                className="tt-input mt-1"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                disabled={busy}
                placeholder="you@company.com"
              />
            </label>

            <label className="mb-1 block text-sm font-medium" htmlFor="login-password">
              Password
              <span className="relative mt-1 block">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  className="tt-input pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-accent"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  tabIndex={0}
                >
                  {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            <label className="mb-5 mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded border-line"
              />
              Remember me for 30 days
            </label>

            <button type="submit" disabled={!canSubmit} className="tt-btn-primary w-full" aria-busy={busy}>
              {busy ? (
                <>
                  <span className="tt-spin inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  <IconLock className="h-4 w-4" /> Sign in
                </>
              )}
            </button>
          </form>

          <a href="/forgot-password" className="mt-4 block text-center text-sm font-medium text-accent hover:underline">
            Forgot password?
          </a>
        </div>
      </div>
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
