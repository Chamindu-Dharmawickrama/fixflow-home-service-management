"use client";

import "./globals.css";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/error-state";
import { Logo } from "@/components/ui/logo";

/**
 * The last-resort boundary, used when the root layout itself fails. It replaces the whole
 * document, so it renders its own `html` and `body` and cannot rely on the layout's fonts.
 */
export default function GlobalError({
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
    <html lang="en">
      <body className="min-h-dvh bg-page font-sans text-base text-ink">
        <main
          id="main-content"
          className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-6"
        >
          <Logo />
          <ErrorState
            title="Something went wrong"
            message="The application hit an unexpected problem and could not load. Try again, and if it keeps happening, contact the business."
            onRetry={reset}
            requestId={error.digest}
            className="w-full"
          />
        </main>
      </body>
    </html>
  );
}
