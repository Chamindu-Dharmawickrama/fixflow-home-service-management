import type {
  InvoiceCustomerDto,
  InvoiceStatus,
  PaymentMethod,
  QuotationBusinessDto,
  QuotationLineDto,
} from "@fixflow/shared";

/**
 * Everything the invoice PDF prints, and nothing else (FR-072, spec §15.4, D-28). It is assembled from
 * the persisted invoice (the snapshot taken at issue, the lines and the payments that stand) by
 * `toInvoicePdfSnapshot`; the builder reads no database, no settings and no clock, so the same
 * snapshot always gives the same document. Money is a decimal string, dates are `YYYY-MM-DD`.
 *
 * A draft (an admin's preview) and a draft that was voided have no number and no dates yet, which is
 * why those three are nullable here and not on the customer's DTO.
 */
export interface InvoicePdfSnapshot {
  invoiceNumber: string | null;
  status: InvoiceStatus;
  statusLabel: string;
  currencyCode: string;
  /** A percentage, two decimal places. */
  taxRate: string;
  lines: Pick<
    QuotationLineDto,
    "id" | "description" | "quantity" | "unitPrice" | "lineTotal" | "taxable"
  >[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  issueDate: string | null;
  dueDate: string | null;
  /** Whole days past the due date; `0` unless the invoice is overdue. */
  daysOverdue: number;
  customerNote: string | null;
  business: QuotationBusinessDto;
  customer: InvoiceCustomerDto;
  paymentInstructions: string | null;
  footer: string | null;
  serviceName: string;
  jobReference: string;
  requestReference: string;
  /** Payments that stand, oldest first. A voided payment is never in this list. */
  payments: { paymentDate: string; method: PaymentMethod; methodLabel: string; amount: string }[];
  /** The day of the last payment, for an invoice paid in full. */
  paidOn: string | null;
}
