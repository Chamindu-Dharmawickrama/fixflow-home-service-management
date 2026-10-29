/**
 * True when this deployment is the public portfolio demo (`NEXT_PUBLIC_DEMO_MODE=true`, D-09, D-31).
 * It is a build-time public variable, so the same answer reaches server and browser code; the API
 * has its own `DEMO_MODE` and the two must be set together.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
