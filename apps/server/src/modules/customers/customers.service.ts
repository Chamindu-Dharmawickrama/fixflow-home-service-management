import {
  type CustomerProfileDto,
  type DeletedAddressDto,
  ErrorCode,
  type ServiceAddressDto,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { DbClient } from "../../lib/db.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { isDemoAccountEmail } from "../auth/auth.domain.js";
import { assertCustomerOwns } from "../auth/auth.middleware.js";
import type { AuthContext } from "../auth/auth.types.js";
import {
  ADDRESS_LIMIT_MESSAGE,
  canAddAddress,
  isFirstAddress,
  pickReplacementDefault,
} from "./customers.domain.js";
import { toCustomerProfileDto, toServiceAddressDto } from "./customers.dto.js";
import type {
  CreateAddressBody,
  UpdateAddressBody,
  UpdateProfileBody,
} from "./customers.schemas.js";

type CustomerDeps = Pick<AppDeps, "prisma" | "config">;

/** Default first, then in the order they were saved; the id makes the order total. */
const ADDRESS_ORDER = [
  { isDefault: "desc" },
  { createdAt: "asc" },
  { id: "asc" },
] as const satisfies Prisma.ServiceAddressOrderByWithRelationInput[];

/**
 * The signed-in customer's id, from the session and nowhere else (FR-014). The route guard has
 * already refused everyone who is not a customer; this fails closed if a route ever forgets it.
 */
function customerIdOf(auth: AuthContext): string {
  if (auth.customerId === undefined) {
    throw forbidden();
  }
  return auth.customerId;
}

/**
 * Takes the customer's row lock for the rest of the transaction. Every change to a customer's
 * addresses starts here, so two of them (a double click, two tabs, a script) run one after the
 * other: the limit of ten cannot be passed by racing requests, and the default can be neither
 * duplicated nor lost. The partial unique index is the database's backstop for the first of those.
 */
async function lockCustomer(tx: DbClient, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customer_profiles WHERE id = ${customerId}::uuid FOR UPDATE`;
}

/** The address, if it is the caller's. Someone else's is `404`, exactly like one that does not exist (D-41). */
async function loadOwnedAddress(tx: DbClient, auth: AuthContext, id: string) {
  const address = await tx.serviceAddress.findUnique({ where: { id } });
  assertCustomerOwns(address?.customerId, auth);
  // `assertCustomerOwns` throws for a missing row, which narrows nothing for the compiler.
  if (address === null) {
    throw notFound();
  }
  return address;
}

// ---- Profile ----------------------------------------------------------------------------------

/** The caller's own details and addresses (default first). */
export async function getMyProfile(
  deps: CustomerDeps,
  auth: AuthContext,
): Promise<CustomerProfileDto> {
  const { prisma, config } = deps;
  const profile = await prisma.customerProfile.findUnique({
    where: { id: customerIdOf(auth) },
    select: {
      phone: true,
      user: {
        select: {
          name: true,
          email: true,
          avatarUrl: true,
          passwordHash: true,
          googleSubject: true,
        },
      },
      addresses: { orderBy: [...ADDRESS_ORDER] },
    },
  });
  if (profile === null) {
    throw notFound();
  }
  return toCustomerProfileDto({
    user: profile.user,
    phone: profile.phone,
    passwordChangeLocked: config.auth.demoMode && isDemoAccountEmail(profile.user.email),
    addresses: profile.addresses,
  });
}

/**
 * Changes the caller's name and/or phone number (FR-013). Both are written in one transaction, so a
 * request that changes both cannot leave one of them changed. Nothing else about the account can
 * be changed here: the schema is strict, and the user is always the session's.
 */
export async function updateMyProfile(
  deps: CustomerDeps,
  auth: AuthContext,
  body: UpdateProfileBody,
): Promise<CustomerProfileDto> {
  const customerId = customerIdOf(auth);
  await deps.prisma.$transaction(async (tx) => {
    if (body.name !== undefined) {
      await tx.user.update({ where: { id: auth.userId }, data: { name: body.name } });
    }
    if (body.phone !== undefined) {
      await tx.customerProfile.update({ where: { id: customerId }, data: { phone: body.phone } });
    }
  });
  return getMyProfile(deps, auth);
}

// ---- Addresses --------------------------------------------------------------------------------

export async function listMyAddresses(
  deps: CustomerDeps,
  auth: AuthContext,
): Promise<ServiceAddressDto[]> {
  const rows = await deps.prisma.serviceAddress.findMany({
    where: { customerId: customerIdOf(auth) },
    orderBy: [...ADDRESS_ORDER],
  });
  return rows.map(toServiceAddressDto);
}

/** Saves a new address. The first one a customer saves becomes the default; at most ten are kept. */
export async function createAddress(
  deps: CustomerDeps,
  auth: AuthContext,
  body: CreateAddressBody,
): Promise<ServiceAddressDto> {
  const customerId = customerIdOf(auth);
  return deps.prisma.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    const count = await tx.serviceAddress.count({ where: { customerId } });
    if (!canAddAddress(count)) {
      throw new AppError(409, ErrorCode.ADDRESS_LIMIT_REACHED, ADDRESS_LIMIT_MESSAGE);
    }
    const row = await tx.serviceAddress.create({
      data: {
        customerId,
        label: body.label,
        line1: body.line1,
        line2: body.line2 ?? null,
        city: body.city,
        region: body.region ?? null,
        postalCode: body.postalCode,
        accessNotes: body.accessNotes ?? null,
        isDefault: isFirstAddress(count),
      },
    });
    return toServiceAddressDto(row);
  });
}

/**
 * Changes the fields that were sent. Requests already made keep the address they were made with
 * (D-36): they hold a copy, so editing the saved address never rewrites history.
 */
export async function updateAddress(
  deps: CustomerDeps,
  auth: AuthContext,
  id: string,
  body: UpdateAddressBody,
): Promise<ServiceAddressDto> {
  const customerId = customerIdOf(auth);
  return deps.prisma.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    await loadOwnedAddress(tx, auth, id);
    const row = await tx.serviceAddress.update({
      where: { id },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.line1 !== undefined && { line1: body.line1 }),
        ...(body.line2 !== undefined && { line2: body.line2 }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.region !== undefined && { region: body.region }),
        ...(body.postalCode !== undefined && { postalCode: body.postalCode }),
        ...(body.accessNotes !== undefined && { accessNotes: body.accessNotes }),
      },
    });
    return toServiceAddressDto(row);
  });
}

/**
 * Makes an address the default. The old default is cleared first and the new one set second, in
 * one transaction, so there is exactly one default before and after. Choosing the default again is
 * harmless and writes nothing.
 */
export async function setDefaultAddress(
  deps: CustomerDeps,
  auth: AuthContext,
  id: string,
): Promise<ServiceAddressDto> {
  const customerId = customerIdOf(auth);
  return deps.prisma.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    const address = await loadOwnedAddress(tx, auth, id);
    if (address.isDefault) {
      return toServiceAddressDto(address);
    }
    await tx.serviceAddress.updateMany({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
    const row = await tx.serviceAddress.update({ where: { id }, data: { isDefault: true } });
    return toServiceAddressDto(row);
  });
}

/**
 * Deletes an address. Requests made with it keep their own copy of the address (D-36), and their
 * link to the saved one is cleared by the database. When the default is deleted, the remaining
 * address that was changed most recently becomes the default, so a customer who still has an
 * address always has a default.
 */
export async function deleteAddress(
  deps: CustomerDeps,
  auth: AuthContext,
  id: string,
): Promise<DeletedAddressDto> {
  const customerId = customerIdOf(auth);
  return deps.prisma.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    const address = await loadOwnedAddress(tx, auth, id);
    await tx.serviceAddress.delete({ where: { id } });

    if (address.isDefault) {
      const remaining = await tx.serviceAddress.findMany({
        where: { customerId },
        select: { id: true, updatedAt: true },
      });
      const next = pickReplacementDefault(remaining);
      if (next !== undefined) {
        await tx.serviceAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
    return { id };
  });
}
