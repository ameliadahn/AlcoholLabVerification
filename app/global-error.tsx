"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f9fafb" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              maxWidth: 400,
              width: "100%",
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #e5e7eb",
              boxShadow: "0 1px 3px rgba(0,0,0,.1)",
              padding: "2rem",
              textAlign: "center",
            }}
          >
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827", marginBottom: 8 }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: 24 }}>
              A critical error occurred. Please reload the page.
              {error.digest && (
                <span style={{ display: "block", marginTop: 4, fontFamily: "monospace", fontSize: "0.75rem", color: "#9ca3af" }}>
                  Error ID: {error.digest}
                </span>
              )}
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={unstable_retry}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#1d4ed8",
                  color: "#fff",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#f3f4f6",
                  color: "#374151",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
