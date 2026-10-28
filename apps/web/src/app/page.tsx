import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Logo } from "@/components/ui/logo";

// Placeholder until the public website (T08) replaces it.
export default function HomePage() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 outline-none"
    >
      <Logo />
      <h1 className="font-display text-4xl font-semibold text-ink">
        Home-service management for a small service business
      </h1>
      <p className="text-lg text-ink-secondary">
        Requests, quotations, scheduling and invoices in one calm place. The application is under
        construction.
      </p>
    </main>
  );
}
