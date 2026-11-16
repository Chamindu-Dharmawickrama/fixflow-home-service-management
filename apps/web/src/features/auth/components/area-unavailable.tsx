import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { ErrorState } from "@/components/ui/error-state";
import { Logo } from "@/components/ui/logo";

/**
 * Shown by the signed-in areas' gates when the API could not say who the visitor is because it did
 * not answer (T25): the hosted API sleeps when idle and can take up to a minute to wake (D-87), and
 * a deploy or an outage looks the same. Nothing of the area is rendered, because who is signed in is
 * unknown; "Try again" loads the same page again. The request id is shown when the API sent one.
 */
export function AreaUnavailablePage({
  retryHref,
  requestId,
}: {
  retryHref: string;
  requestId?: string | undefined;
}) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-6 outline-none"
    >
      <Logo />
      <h1 className="sr-only">FixFlow is not available</h1>
      <ErrorState
        title="We can't reach FixFlow right now"
        message="The server isn't answering. It may be starting up after a quiet spell, which can take up to a minute. Nothing you saved is lost: try again in a moment."
        retryHref={retryHref}
        // The gate is a layout: only a full load renders it again.
        retryReloads
        requestId={requestId}
        className="w-full"
      />
    </main>
  );
}
