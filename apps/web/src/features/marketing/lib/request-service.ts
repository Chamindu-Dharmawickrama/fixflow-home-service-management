import { loginUrl } from "@/lib/auth/paths";

/**
 * Where "Request a service" goes. The request form is built in T11; until it lands, `/request-service`
 * does not exist and must not be linked. So for now the call to action leads to sign-in, then the
 * customer portal (T08 prompt, D-88). The copy beside each call to action says that an account comes
 * first, which stays true after T11 (a visitor is asked to sign in or register before the form).
 *
 * T11 replaces the body with `/request-service` (and `?service=<slug>` when a service is given);
 * nothing else on the public site needs to change.
 */
export function requestServiceHref(_serviceSlug?: string): string {
  return loginUrl("/portal");
}
