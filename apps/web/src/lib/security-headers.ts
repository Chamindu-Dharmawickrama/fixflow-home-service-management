/**
 * The web app's security headers (T25, D-113), set in `next.config.ts` on every page and file the
 * web server answers (the API's own responses through the `/api/v1/*` proxy keep helmet's headers).
 *
 * The Content Security Policy allows exactly what the pages load:
 * - scripts from this origin, plus Google Identity Services' client (`accounts.google.com/gsi/client`,
 *   D-07, D-11). `'unsafe-inline'` is needed because the App Router streams its data in inline
 *   `<script>` tags and the pages are prerendered (Partial Prerendering, D-55): a per-request nonce
 *   would make every page dynamic. Development also needs `'unsafe-eval'` (React's debugging tools).
 * - styles from this origin and Google's button stylesheet; inline styles (Radix positions its popovers
 *   with a `style` attribute).
 * - images from this origin, `data:`/`blob:`, and any `https:` address: the business may set its logo
 *   and service pictures to an https address of its choice (D-30), and Google avatars are on
 *   `lh3.googleusercontent.com`.
 * - connections and frames to this origin and Google Identity Services only (`/gsi/` paths).
 * - no plugins, no `<base>` from elsewhere, forms posting to this origin only, and **no framing by any
 *   site** (`frame-ancestors 'none'`, plus `X-Frame-Options: DENY` for older browsers).
 *
 * `Cross-Origin-Opener-Policy: same-origin-allow-popups` keeps Google's sign-in popup working
 * (`same-origin` would cut it off from this page).
 */

const GOOGLE_IDENTITY = "https://accounts.google.com/gsi/";

export interface SecurityHeader {
  key: string;
  value: string;
}

/** The Content Security Policy, one directive per entry. */
export function contentSecurityPolicy(options: { development: boolean }): string {
  const { development } = options;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""} ${GOOGLE_IDENTITY}client`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_IDENTITY}style`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Development: the dev server's hot reload talks over a WebSocket.
    `connect-src 'self' ${GOOGLE_IDENTITY}${development ? " ws: wss:" : ""}`,
    `frame-src ${GOOGLE_IDENTITY}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/** Every header the web server adds to its own responses. */
export function securityHeaders(options: { development: boolean }): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      // Nothing in FixFlow uses these; a script that tried would be refused.
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    // Browsers ignore this over plain http, so it only matters on the HTTPS deployment.
    ...(options.development
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
}
