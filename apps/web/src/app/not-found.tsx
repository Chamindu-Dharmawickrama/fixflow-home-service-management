import type { Metadata } from "next";
import Link from "next/link";

import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-5 px-6 text-center outline-none"
    >
      <Logo />
      <p className="font-display text-5xl font-semibold text-brand">404</p>
      <h1 className="font-display text-2xl font-semibold text-ink">
        We couldn&apos;t find that page
      </h1>
      <p className="text-base text-ink-secondary">
        The link may be out of date, or the page may have moved. Check the address, or start again
        from the home page.
      </p>
      <Button asChild size="lg">
        <Link href="/">Go to the home page</Link>
      </Button>
    </main>
  );
}
