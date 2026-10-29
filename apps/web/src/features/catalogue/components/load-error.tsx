import { ErrorState } from "@/components/ui/error-state";
import { describeApiError, isApiError } from "@/lib/api";

/**
 * Decides what a page does when its data could not be loaded. Call it from a `catch` block and
 * return the result.
 *
 * - A server or network problem becomes an in-page error with a retry, so the navigation and the
 *   rest of the shell stay (the person can still go elsewhere).
 * - `401` and `403` become nothing at all. The area layout is the access gate: it has already
 *   redirected a visitor without a session, or is showing a customer the "this area is for the
 *   business team" page. Next.js still runs the page's data loading beside the layout, so without
 *   this the refused request would surface as an unhandled error in the server log.
 * - Anything else that means "this is not here" is rethrown, for the not-found page or the error
 *   boundary to handle.
 */
export function loadErrorState({
  error,
  title,
  retryHref,
}: {
  error: unknown;
  title: string;
  retryHref: string;
}) {
  if (isApiError(error) && (error.status === 401 || error.status === 403)) {
    return null;
  }
  if (!isApiError(error) || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
    throw error;
  }
  return (
    <ErrorState
      title={title}
      message={
        error.code === "NETWORK_ERROR"
          ? "We couldn't reach the server. Check your connection and try again."
          : `${describeApiError(error)} Try again in a moment.`
      }
      requestId={error.requestId}
      retryHref={retryHref}
    />
  );
}
