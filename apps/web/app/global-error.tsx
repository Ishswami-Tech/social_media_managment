"use client";

/** Last-resort boundary when even the root layout fails; must render its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something broke before the page could load</h1>
        <p style={{ color: "#666", fontSize: "0.9rem" }}>Reload to try again. If it keeps happening, share the reference below.</p>
        {error.digest && <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#666" }}>{error.digest}</p>}
        <button
          type="button"
          onClick={() => reset()}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #ccc", background: "white", cursor: "pointer" }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
