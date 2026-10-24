"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-sm text-muted">{error?.message ?? "An unexpected error occurred."}</p>
      {error?.digest && <p className="font-mono text-xs text-muted">Digest: {error.digest}</p>}
      <button onClick={() => reset()} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
