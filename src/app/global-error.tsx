"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ maxWidth: 480, color: "#64748b", fontSize: 14, margin: 0 }}>
            An unexpected error occurred. You can try again, or go back to your work.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8", margin: 0 }}>Error ID: {error.digest}</p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              onClick={reset}
              style={{ background: "#4f46e5", color: "#fff", border: 0, borderRadius: 6, padding: "8px 14px", fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
            <a href="/" style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 14px", fontWeight: 600, color: "#0f172a", textDecoration: "none" }}>
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
