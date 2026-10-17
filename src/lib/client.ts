"use client";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message ?? `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { status: number; code: string };
    err.status = res.status;
    err.code = json.error?.code ?? "error";
    throw err;
  }
  return json.data as T;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
