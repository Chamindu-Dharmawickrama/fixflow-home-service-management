/**
 * Domain enumerations (spec §6, D-27, D-29, D-38). Each is a const object whose keys equal its
 * values, so the same string is the TypeScript name, the JSON wire value and the database enum
 * value. The API's Prisma schema declares the same enums; a parity test in `apps/server` fails if
 * the two ever differ, so change both together (and add a migration).
 */

/** The two authenticated roles. Technicians are resource records, not users. */
export const Role = {
  BUSINESS_ADMIN: "BUSINESS_ADMIN",
  CUSTOMER: "CUSTOMER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const PricingMode = {
  /** Shown as "From $X". Still goes through a quotation (D-50). */
  FIXED: "FIXED",
  /** Shown as "Request a quote". */
  QUOTE_REQUIRED: "QUOTE_REQUIRED",
} as const;
export type PricingMode = (typeof PricingMode)[keyof typeof PricingMode];

/** Spec §6.2. The request status summarises the enquiry; quotations and jobs have their own. */
export const ServiceRequestStatus = {
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  QUOTED: "QUOTED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  CONVERTED_TO_JOB: "CONVERTED_TO_JOB",
  CANCELLED: "CANCELLED",
} as const;
export type ServiceRequestStatus = (typeof ServiceRequestStatus)[keyof typeof ServiceRequestStatus];

/** Preferred appointment window; the hours are business-timezone settings (D-35). */
export const PreferredWindow = {
  MORNING: "MORNING",
  AFTERNOON: "AFTERNOON",
  EVENING: "EVENING",
} as const;
export type PreferredWindow = (typeof PreferredWindow)[keyof typeof PreferredWindow];

export const NoteVisibility = {
  INTERNAL: "INTERNAL",
  CUSTOMER_VISIBLE: "CUSTOMER_VISIBLE",
} as const;
export type NoteVisibility = (typeof NoteVisibility)[keyof typeof NoteVisibility];

/** Spec §6.3. */
export const QuotationStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
  VOID: "VOID",
} as const;
export type QuotationStatus = (typeof QuotationStatus)[keyof typeof QuotationStatus];

/** Spec §6.4. */
export const WorkOrderStatus = {
  PENDING_SCHEDULING: "PENDING_SCHEDULING",
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  NEEDS_RESCHEDULING: "NEEDS_RESCHEDULING",
} as const;
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

/** Spec §6.5. */
export const InvoiceStatus = {
  DRAFT: "DRAFT",
  ISSUED: "ISSUED",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  VOID: "VOID",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

/** How a manually recorded payment was received (D-27). No payment is processed by FixFlow. */
export const PaymentMethod = {
  CASH: "CASH",
  BANK_TRANSFER: "BANK_TRANSFER",
  /** Taken on a card terminal outside FixFlow. */
  CARD_TERMINAL: "CARD_TERMINAL",
  CHEQUE: "CHEQUE",
  OTHER: "OTHER",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** One value per notification event (D-38). */
export const NotificationType = {
  // To all admins
  REQUEST_RECEIVED: "REQUEST_RECEIVED",
  QUOTATION_ACCEPTED: "QUOTATION_ACCEPTED",
  QUOTATION_DECLINED: "QUOTATION_DECLINED",
  // To the owning customer
  QUOTATION_SENT: "QUOTATION_SENT",
  QUOTATION_WITHDRAWN: "QUOTATION_WITHDRAWN",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  NOTE_ADDED: "NOTE_ADDED",
  JOB_SCHEDULED: "JOB_SCHEDULED",
  JOB_RESCHEDULED: "JOB_RESCHEDULED",
  JOB_NEEDS_RESCHEDULING: "JOB_NEEDS_RESCHEDULING",
  JOB_COMPLETED: "JOB_COMPLETED",
  JOB_CANCELLED: "JOB_CANCELLED",
  INVOICE_ISSUED: "INVOICE_ISSUED",
  INVOICE_VOIDED: "INVOICE_VOIDED",
  PAYMENT_RECORDED: "PAYMENT_RECORDED",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Delivery state of one email. `LOGGED` means the log transport wrote it; never `SENT` (D-13). */
export const EmailDeliveryStatus = {
  PENDING: "PENDING",
  SENT: "SENT",
  LOGGED: "LOGGED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type EmailDeliveryStatus = (typeof EmailDeliveryStatus)[keyof typeof EmailDeliveryStatus];

/** What an activity event is about (D-29). */
export const ActivityEntityType = {
  SERVICE_REQUEST: "SERVICE_REQUEST",
  QUOTATION: "QUOTATION",
  WORK_ORDER: "WORK_ORDER",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
  SERVICE: "SERVICE",
  TECHNICIAN: "TECHNICIAN",
  SETTINGS: "SETTINGS",
  CUSTOMER: "CUSTOMER",
} as const;
export type ActivityEntityType = (typeof ActivityEntityType)[keyof typeof ActivityEntityType];

/** The documents that carry a human-readable reference with a yearly counter (D-17). */
export const ReferenceType = {
  REQUEST: "REQUEST",
  QUOTATION: "QUOTATION",
  WORK_ORDER: "WORK_ORDER",
  INVOICE: "INVOICE",
} as const;
export type ReferenceType = (typeof ReferenceType)[keyof typeof ReferenceType];
