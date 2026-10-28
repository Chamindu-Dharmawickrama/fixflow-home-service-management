/** The id every page's main landmark carries; the skip link jumps to it. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * The first focusable element on every page. It stays off-screen until a keyboard user tabs to
 * it, then lets them skip the header and navigation straight to the page content (WCAG 2.4.1).
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-surface focus:shadow-lg"
    >
      Skip to main content
    </a>
  );
}
