import { ErrorState } from "@/components/ui/error-state";

export interface CatalogueUnavailableProps {
  /** What could not be shown: "our services", "this service". */
  what: string;
  /** The page's own path, so "Try again" loads it afresh. */
  retryHref: string;
}

/**
 * Shown in place of a section when the API cannot be reached (a cold start, an outage). It is a
 * calm message with a retry rather than an error page: the rest of the page, the navigation and the
 * footer are all still there.
 */
export function CatalogueUnavailable({ what, retryHref }: CatalogueUnavailableProps) {
  return (
    <ErrorState
      title={`We can't show ${what} right now`}
      message="Our system is taking longer than usual to respond. Nothing is wrong with your connection. Please try again in a moment."
      retryHref={retryHref}
    />
  );
}
