/** The customers-only request form (spec §9.1). Signed-out visitors are sent to sign-in first. */
export const REQUEST_SERVICE_PATH = "/request-service";

/** The query parameter that preselects a service on the form: `/request-service?service=<slug>`. */
export const SERVICE_PARAM = "service";

/**
 * Where "Request a service" and "Request this service" go (T11, spec §7.1). A visitor without an
 * account is sent from the form to sign-in and returned to it afterwards, with the service still
 * chosen (`proxy.ts`), so the public site links straight to the form and needs no sign-in logic of
 * its own. With a service slug the form opens with that service selected.
 */
export function requestServiceHref(serviceSlug?: string): string {
  return serviceSlug === undefined || serviceSlug === ""
    ? REQUEST_SERVICE_PATH
    : `${REQUEST_SERVICE_PATH}?${SERVICE_PARAM}=${encodeURIComponent(serviceSlug)}`;
}
