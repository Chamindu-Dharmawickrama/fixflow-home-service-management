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
  /** The largest subtotal or total a document can hold: its `Decimal(12,2)` columns. */
  documentAmount: { max: "9999999999.99" },
  /** What a line of a quotation or invoice says. */
  lineDescription: { minLength: 1, maxLength: 200 },
  /** Percentage, so `8.25` means 8.25 %. */
  taxRate: { min: "0", max: "100" },
  discount: { min: "0.00" },
  paymentAmount: { min: "0.01" },
  requestDescription: { minLength: 20, maxLength: 2000 },
  /** How far ahead a customer may ask for a visit, counted in business-time-zone days from today (D-35). */
  preferredDate: { minDaysAhead: 1, maxDaysAhead: 90 },
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
  /**
   * A customer's own phone number (FR-013): digits, spaces and `+ - ( )`, 7 to 20 characters once
   * the spaces are tidied. At least 7 and at most 15 of them must be digits (the E.164 maximum).
   */
  customerPhone: { minLength: 7, maxLength: 20, minDigits: 7, maxDigits: 15 },
  /** A customer's saved service addresses (FR-013, T10). */
  address: {
    maxPerCustomer: 10,
    label: { minLength: 2, maxLength: 40 },
    line: { maxLength: 120 },
    city: { maxLength: 80 },
    region: { maxLength: 80 },
    postalCode: { maxLength: 20 },
    /** "Gate code, parking, pets…": private to the customer and the business. */
    accessNotes: { maxLength: 500 },
  },
  /** Business settings (FR-100). Day counts are whole days. */
  businessSettings: {
    businessName: { minLength: 2, maxLength: 100 },
    tagline: { maxLength: 160 },
    /** Counted in characters, punctuation included; the digits are checked separately. */
    phone: { maxLength: 30, minDigits: 7, maxDigits: 15 },
    addressLine: { maxLength: 120 },
    city: { maxLength: 80 },
    region: { maxLength: 80 },
    postalCode: { maxLength: 20 },
    serviceArea: { maxLength: 500 },
    logoUrl: { maxLength: 500 },
    quotationValidityDays: { min: 1, max: 90 },
    invoiceDueDays: { min: 0, max: 90 },
    quotationTerms: { maxLength: 2000 },
    paymentInstructions: { maxLength: 1000 },
    invoiceFooter: { maxLength: 500 },
  },
  /**
   * Technician resources (FR-060, T16). The name follows `personName`, and the phone number the
   * customer rule above (`customerPhone`): a person's number is a person's number.
   */
  technician: {
    specialties: { maxItems: 8, itemMaxLength: 40 },
    /** Internal: never in a customer-facing shape. */
    notes: { maxLength: 1000 },
    search: { maxLength: 100 },
  },
  /** The service catalogue (FR-101, D-50). */
  service: {
    name: { minLength: 3, maxLength: 80 },
    category: { minLength: 2, maxLength: 50 },
    shortDescription: { minLength: 10, maxLength: 200 },
    fullDescription: { minLength: 20, maxLength: 2000 },
    inclusions: { maxItems: 12, itemMaxLength: 120 },
    durationMinutes: { min: 5, max: 720 },
    sortOrder: { min: 0, max: 9999 },
    imageUrl: { maxLength: 500 },
    search: { maxLength: 100 },
    /** "From" price; a service with a fixed price costs at least one cent. */
    startingPrice: { min: "0.01", max: "999999.99" },
  },
} as const;
