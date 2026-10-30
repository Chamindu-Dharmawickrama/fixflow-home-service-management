import type { CustomerProfileDto, ServiceAddressDto } from "@fixflow/shared";

import type { ServiceAddress } from "../../generated/prisma/client.js";

/**
 * Serializers for the customer's own profile and addresses (CLAUDE.md §7: one per audience, field
 * by field). This is the customer's view of their own data: the admin's view of a customer is a
 * separate serializer (T13). Nothing is copied wholesale from a row, so a column added later, or the
 * owner's `customerId`, can never leak by accident.
 */

export function toServiceAddressDto(row: ServiceAddress): ServiceAddressDto {
  return {
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    accessNotes: row.accessNotes,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The columns {@link toCustomerProfileDto} reads. The password hash and Google subject become booleans. */
export interface ProfileUserRecord {
  name: string;
  email: string;
  avatarUrl: string | null;
  passwordHash: string | null;
  googleSubject: string | null;
}

export function toCustomerProfileDto(input: {
  user: ProfileUserRecord;
  phone: string | null;
  passwordChangeLocked: boolean;
  addresses: readonly ServiceAddress[];
}): CustomerProfileDto {
  const { user, phone, passwordChangeLocked, addresses } = input;
  return {
    name: user.name,
    email: user.email,
    phone,
    avatarUrl: user.avatarUrl,
    hasPassword: user.passwordHash !== null,
    hasGoogle: user.googleSubject !== null,
    passwordChangeLocked,
    addresses: addresses.map(toServiceAddressDto),
  };
}
