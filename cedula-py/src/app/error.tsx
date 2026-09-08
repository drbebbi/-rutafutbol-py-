"use client";

import { useEffect } from "react";

/**
 * The browser learns a code and a correlation id, never an internal message or
 * a stack trace.
 */
export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    // `digest` is the server-generated correlation id. The message itself stays
    // on the server.
    console.error(JSON.stringify({ event: "client_error_boundary", correlationId: error.digest ?? "unknown" }));
  }, [error.digest]);

  return (
    <main className="mx-auto max-w-xl p-6" data-testid="error-boundary">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        The request could not be completed. If you contact support, quote reference{" "}
        <code data-testid="correlation-id">{error.digest ?? "unknown"}</code>.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Try again
      </button>
    </main>
  );
}
