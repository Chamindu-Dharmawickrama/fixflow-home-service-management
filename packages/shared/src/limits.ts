/**
 * Validation limits (D-20, BR-06). The server enforces them and the web app reuses them for
 * form hints. Monetary and decimal bounds are decimal strings, never JS numbers, so they can be
 * handed straight to `decimal.js` (money is never a float).
 *
 * Bounds that depend on another value are not constants and live in the domain code that knows
 * the value: a discount is `0` up to the document subtotal, and a payment is `0.01` up to the
 * remaining balance.
 */
export const LIMITS = {
  pagination: {
    defaultPageSize: 20,
    maxPageSize: 100,
    /** Keeps `(page - 1) * pageSize` far below the 32-bit `skip` accepted by the database. */
    maxPage: 100_000,
  },
  lineItems: { min: 1, max: 50 },
  quantity: { min: "0.01", max: "9999.99" },
  unitPrice: { min: "0.00", max: "999999.99" },
  /** Percentage, so `8.25` means 8.25 %. */
  taxRate: { min: "0", max: "100" },
  discount: { min: "0.00" },
  paymentAmount: { min: "0.01" },
  requestDescription: { minLength: 20, maxLength: 2000 },
  /** Free-text notes (internal or customer-visible). */
  notes: { maxLength: 2000 },
  /** Cancellation, decline, void and correction reasons. */
  reason: { minLength: 5, maxLength: 500 },
  appointment: { maxDurationMinutes: 12 * 60 },
  /** Local passwords (D-51): length only, no composition rules (NIST SP 800-63B style). */
  password: { minLength: 10, maxLength: 128 },
  /** A person's display name. */
  personName: { minLength: 2, maxLength: 100 },
  /** The longest valid email address (RFC 5321). */
  email: { maxLength: 254 },
} as const;
