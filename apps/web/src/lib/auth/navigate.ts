/**
 * Goes to `path` with a full page load. Used when the session has just changed (signed in, signed
 * out, password reset). A client-side navigation would keep the router's cache of pages rendered
 * for the previous session, and could show a signed-in page to a signed-out visitor or the other
 * way round; a real load starts from nothing, so every layout reads the new session.
 */
export function navigateWithFullReload(path: string): void {
  window.location.assign(path);
}
