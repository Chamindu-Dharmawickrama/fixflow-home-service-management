import type {
  EmailDeliveryStatus,
  InvoiceStatus,
  NotificationReadState,
  PaymentRecordState,
  QuotationStatus,
  ServiceRequestStatus,
  WorkOrderStatus,
} from "@fixflow/shared";

/**
 * Meaning of the five status colours. A status badge always shows the label as text as well; the
 * colour is never the only signal.
 *
 * - `info`      new, queued or waiting on someone
 * - `attention` someone needs to act, or a decision is pending
 * - `success`   a positive outcome
 * - `danger`    a problem or an overdue balance
 * - `neutral`   closed, terminal, draft or void
 */
export const STATUS_TONES = ["info", "attention", "success", "danger", "neutral"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/** Icon keys; `components/ui/status-badge.tsx` maps each one to a Lucide icon. */
export const STATUS_ICON_NAMES = [
  "inbox",
  "clipboard-list",
  "file-text",
  "circle-check",
  "circle-x",
  "briefcase",
  "ban",
  "file-pen",
  "send",
  "timer-off",
  "calendar-clock",
  "calendar-check",
  "wrench",
  "calendar-x",
  "receipt",
  "circle-dashed",
  "triangle-alert",
  "banknote",
  "bell-dot",
  "check",
  "clock",
  "mail-check",
  "scroll-text",
  "mail-x",
  "circle-minus",
  "circle-help",
] as const;
export type StatusIconName = (typeof STATUS_ICON_NAMES)[number];

export interface StatusMeta {
  /** Short text shown in the badge. */
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: StatusIconName;
  /**
   * One sentence that says what the status means and what happens next. Written to be safe to show
   * a customer wherever the status itself is customer-visible (draft and delivery statuses are
   * staff-only, and their sentences describe the staff view).
   */
  readonly description: string;
}

/** Every record type that can carry a status badge. */
export type StatusKind =
  "request" | "quotation" | "workOrder" | "invoice" | "payment" | "notification" | "emailDelivery";

export interface StatusValueByKind {
  request: ServiceRequestStatus;
  quotation: QuotationStatus;
  workOrder: WorkOrderStatus;
  invoice: InvoiceStatus;
  payment: PaymentRecordState;
  notification: NotificationReadState;
  emailDelivery: EmailDeliveryStatus;
}

export type StatusMetaTable = { [K in StatusKind]: Record<StatusValueByKind[K], StatusMeta> };

/**
 * The status vocabulary (docs/DESIGN_SYSTEM.md §8). Each table is keyed by the full enum, so adding
 * a value to `@fixflow/shared` without giving it a label, tone and icon is a compile error.
 */
export const STATUS_META: StatusMetaTable = {
  request: {
    SUBMITTED: {
      label: "Submitted",
      tone: "info",
      icon: "inbox",
      description: "We've received your request. A team member will review it soon.",
    },
    UNDER_REVIEW: {
      label: "Under review",
      tone: "info",
      icon: "clipboard-list",
      description: "We're reviewing the details and preparing your quotation.",
    },
    QUOTED: {
      label: "Quoted",
      tone: "attention",
      icon: "file-text",
      description: "A quotation is ready for you to review and answer.",
    },
    ACCEPTED: {
      label: "Accepted",
      tone: "success",
      icon: "circle-check",
      description: "You accepted the quotation. We'll schedule the job next.",
    },
    DECLINED: {
      label: "Declined",
      tone: "neutral",
      icon: "circle-x",
      description: "You declined the quotation, so no work will be scheduled.",
    },
    CONVERTED_TO_JOB: {
      label: "Converted to job",
      tone: "success",
      icon: "briefcase",
      description: "Your job has been created. Follow its progress under Jobs.",
    },
    CANCELLED: {
      label: "Cancelled",
      tone: "neutral",
      icon: "ban",
      description: "This request was cancelled, so no work will be carried out.",
    },
  },
  quotation: {
    DRAFT: {
      label: "Draft",
      tone: "neutral",
      icon: "file-pen",
      description: "Still being prepared. Customers can't see it yet.",
    },
    SENT: {
      label: "Sent",
      tone: "attention",
      icon: "send",
      description: "Waiting for your decision. Accept or decline it before it expires.",
    },
    ACCEPTED: {
      label: "Accepted",
      tone: "success",
      icon: "circle-check",
      description: "Accepted. The job will be scheduled next.",
    },
    DECLINED: {
      label: "Declined",
      tone: "neutral",
      icon: "circle-x",
      description: "Declined, so no work will be scheduled from this quotation.",
    },
    EXPIRED: {
      label: "Expired",
      tone: "neutral",
      icon: "timer-off",
      description: "No longer available because its validity date has passed.",
    },
    VOID: {
      label: "Void",
      tone: "neutral",
      icon: "ban",
      description: "Withdrawn by the business. A replacement quotation may follow.",
    },
  },
  workOrder: {
    PENDING_SCHEDULING: {
      label: "Pending scheduling",
      tone: "attention",
      icon: "calendar-clock",
      description: "The quotation was accepted. We'll confirm a date and time soon.",
    },
    SCHEDULED: {
      label: "Scheduled",
      tone: "info",
      icon: "calendar-check",
      description: "Your appointment is confirmed for the date and time shown.",
    },
    IN_PROGRESS: {
      label: "In progress",
      tone: "info",
      icon: "wrench",
      description: "The work has started.",
    },
    COMPLETED: {
      label: "Completed",
      tone: "success",
      icon: "circle-check",
      description: "The work is finished. An invoice will follow.",
    },
    CANCELLED: {
      label: "Cancelled",
      tone: "neutral",
      icon: "ban",
      description: "This job was cancelled, so no work will be carried out.",
    },
    NEEDS_RESCHEDULING: {
      label: "Needs rescheduling",
      tone: "attention",
      icon: "calendar-x",
      description: "We need to agree a new time for your appointment and will be in touch.",
    },
  },
  invoice: {
    DRAFT: {
      label: "Draft",
      tone: "neutral",
      icon: "file-pen",
      description: "Still being prepared. Customers can't see it yet.",
    },
    ISSUED: {
      label: "Issued",
      tone: "info",
      icon: "receipt",
      description: "Payment is due by the due date shown.",
    },
    PARTIALLY_PAID: {
      label: "Partially paid",
      tone: "attention",
      icon: "circle-dashed",
      description: "Part of the payment has been recorded. The remaining balance is still due.",
    },
    PAID: {
      label: "Paid",
      tone: "success",
      icon: "circle-check",
      description: "Paid in full. Thank you.",
    },
    OVERDUE: {
      label: "Overdue",
      tone: "danger",
      icon: "triangle-alert",
      description: "The due date has passed and a balance remains. Please arrange payment.",
    },
    VOID: {
      label: "Void",
      tone: "neutral",
      icon: "ban",
      description: "Cancelled by the business, so there is nothing to pay.",
    },
  },
  payment: {
    RECORDED: {
      label: "Recorded",
      tone: "success",
      icon: "banknote",
      description: "The business recorded this payment against the invoice.",
    },
    VOID: {
      label: "Voided",
      tone: "neutral",
      icon: "ban",
      description:
        "Corrected: this payment record was voided and no longer counts towards the balance.",
    },
  },
  notification: {
    UNREAD: {
      label: "New",
      tone: "info",
      icon: "bell-dot",
      description: "You haven't opened this notification yet.",
    },
    READ: {
      label: "Read",
      tone: "neutral",
      icon: "check",
      description: "You've already opened this notification.",
    },
  },
  emailDelivery: {
    PENDING: {
      label: "Queued",
      tone: "info",
      icon: "clock",
      description: "Waiting to be sent.",
    },
    SENT: {
      label: "Sent",
      tone: "success",
      icon: "mail-check",
      description: "Handed to the mail server. Arrival in the inbox isn't confirmed.",
    },
    LOGGED: {
      label: "Logged only",
      tone: "neutral",
      icon: "scroll-text",
      description: "Written to the server log; no email was sent.",
    },
    FAILED: {
      label: "Failed",
      tone: "danger",
      icon: "mail-x",
      description: "Sending failed. The action it belongs to was not affected.",
    },
    SKIPPED: {
      label: "Skipped",
      tone: "neutral",
      icon: "circle-minus",
      description: "Not sent, for example because the address is reserved for demo use.",
    },
  },
};

function humanise(value: string): string {
  const spaced = value.toLowerCase().replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Label, tone, icon and description for a status. A value the web app does not know (the API
 * gained a status before this file did) still renders, as a neutral badge with a readable label.
 */
export function getStatusMeta<K extends StatusKind>(
  kind: K,
  status: StatusValueByKind[K],
): StatusMeta {
  const table: Readonly<Record<string, StatusMeta>> = STATUS_META[kind];
  return (
    table[status] ?? {
      label: humanise(status),
      tone: "neutral",
      icon: "circle-help",
      description: "",
    }
  );
}

/** Just the label, for places that cannot render a badge (page titles, emails, toasts). */
export function statusLabel<K extends StatusKind>(kind: K, status: StatusValueByKind[K]): string {
  return getStatusMeta(kind, status).label;
}
