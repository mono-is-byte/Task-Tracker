"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ minHeight: "50vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#64748b" }}>{error?.message ?? "An unexpected error occurred."}</p>
          {error?.digest && <p style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>Digest: {error.digest}</p>}
          <button onClick={() => reset()} style={{ background: "#4f46e5", color: "#fff", padding: "8px 16px", borderRadius: 8, border: 0, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
