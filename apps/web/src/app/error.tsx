"use client";

import { useEffect } from "react";

import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { ErrorState } from "@/components/ui/error-state";
import { Logo } from "@/components/ui/logo";

/**
 * The boundary for an unexpected error while rendering a page. It never shows the error's own
 * message (it could contain internals); the digest is a reference that can be found in the logs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-6 outline-none"
    >
      <Logo />
      <ErrorState
        title="Something went wrong"
        message="We hit an unexpected problem loading this page. Try again, and if it keeps happening, contact the business."
        onRetry={reset}
        requestId={error.digest}
        className="w-full"
      />
    </main>
  );
}
