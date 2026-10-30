import { LIMITS } from "@fixflow/shared";

/**
 * Pure rules for a customer's saved addresses (FR-013, T10): how many there may be, which one is
 * the default when there was none, and which takes over when the default is deleted. The service
 * applies them inside a transaction that holds the customer's row lock, so they never race.
 */

export const MAX_ADDRESSES = LIMITS.address.maxPerCustomer;

export const ADDRESS_LIMIT_MESSAGE = `You can save up to ${MAX_ADDRESSES} addresses. Delete one you no longer use to add another.`;

/** A customer who already has {@link MAX_ADDRESSES} addresses cannot add another. */
export function canAddAddress(currentCount: number): boolean {
  return currentCount < MAX_ADDRESSES;
}

/** The first address a customer saves becomes the default, so there is a default as soon as there is an address. */
export function isFirstAddress(currentCount: number): boolean {
  return currentCount === 0;
}

export interface AddressForPromotion {
  id: string;
  updatedAt: Date;
}

/**
 * The address that becomes the default when the default is deleted: the remaining one that was
 * changed most recently, because it is the one the customer is most likely still using. Addresses
 * changed at the same instant are told apart by id, so the answer never depends on row order.
 * Returns `undefined` when nothing remains.
 */
export function pickReplacementDefault(
  remaining: readonly AddressForPromotion[],
): AddressForPromotion | undefined {
  let best: AddressForPromotion | undefined;
  for (const candidate of remaining) {
    if (
      best === undefined ||
      candidate.updatedAt.getTime() > best.updatedAt.getTime() ||
      (candidate.updatedAt.getTime() === best.updatedAt.getTime() && candidate.id > best.id)
    ) {
      best = candidate;
    }
  }
  return best;
}
