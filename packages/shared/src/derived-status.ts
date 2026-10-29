/**
 * Display states that are derived from another column instead of being stored as a database enum:
 * a payment record is void when `voidedAt` is set, a notification is read when `readAt` is set.
 * They live apart from `enums.ts` because that file must match the Prisma enums exactly; the web
 * app uses these to give payments and notifications the same status badge as every other record.
 */

export const PaymentRecordState = {
  RECORDED: "RECORDED",
  VOID: "VOID",
} as const;
export type PaymentRecordState = (typeof PaymentRecordState)[keyof typeof PaymentRecordState];

export const NotificationReadState = {
  UNREAD: "UNREAD",
  READ: "READ",
} as const;
export type NotificationReadState =
  (typeof NotificationReadState)[keyof typeof NotificationReadState];

/**
 * Where a service stands in the catalogue (D-50). Stored as two columns, `isPublished` and
 * `archivedAt`; an archived service is never published, so the three states are exclusive.
 */
export const ServiceCatalogueState = {
  PUBLISHED: "PUBLISHED",
  UNPUBLISHED: "UNPUBLISHED",
  ARCHIVED: "ARCHIVED",
} as const;
export type ServiceCatalogueState =
  (typeof ServiceCatalogueState)[keyof typeof ServiceCatalogueState];

/** Archived wins: a row that is somehow both archived and published is still archived. */
export function serviceCatalogueState(service: {
  readonly isPublished: boolean;
  readonly archivedAt: Date | string | null;
}): ServiceCatalogueState {
  if (service.archivedAt !== null) {
    return ServiceCatalogueState.ARCHIVED;
  }
  return service.isPublished ? ServiceCatalogueState.PUBLISHED : ServiceCatalogueState.UNPUBLISHED;
}

/** A payment record is never deleted; a correction voids it (BR-16). */
export function paymentRecordState(payment: {
  readonly voidedAt: string | null;
}): PaymentRecordState {
  return payment.voidedAt === null ? PaymentRecordState.RECORDED : PaymentRecordState.VOID;
}

export function notificationReadState(notification: {
  readonly readAt: string | null;
}): NotificationReadState {
  return notification.readAt === null ? NotificationReadState.UNREAD : NotificationReadState.READ;
}
