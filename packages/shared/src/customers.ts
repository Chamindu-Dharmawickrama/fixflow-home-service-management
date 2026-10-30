/**
 * A saved service address, as its owner sees it (T10). `accessNotes` is private to the customer and
 * the business team: it never appears in a public payload, a log or a notification.
 */
export interface ServiceAddressDto {
  id: string;
  /** What the customer calls it: "Home", "Rental unit". */
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  /** "Gate code, parking, pets…" */
  accessNotes: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /api/v1/customers/me`: the signed-in customer's own details and addresses (default first).
 * `email` is shown but cannot be changed (D-39), and no role, user id or customer id is included.
 */
export interface CustomerProfileDto {
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  /** The account has a local password (so "Change password" applies). */
  hasPassword: boolean;
  /** The account is linked to a Google identity. */
  hasGoogle: boolean;
  /** True for the shared demo accounts while the API runs in demo mode (D-09): no password changes. */
  passwordChangeLocked: boolean;
  /** At most {@link LIMITS.address.maxPerCustomer}; exactly one has `isDefault` unless there are none. */
  addresses: ServiceAddressDto[];
}

/** `DELETE /api/v1/customers/me/addresses/:id`. */
export interface DeletedAddressDto {
  id: string;
}
