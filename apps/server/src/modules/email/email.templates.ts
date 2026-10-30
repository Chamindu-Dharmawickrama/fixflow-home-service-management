import {
  formatEmailDate,
  formatEmailDateTime,
  formatEmailMoney,
  formatEmailWindow,
} from "./email.format.js";
import { type EmailBranding, type RenderedEmail, renderEmail } from "./email.layout.js";

/**
 * The transactional email templates (D-13, D-38, FR-091, FR-092). Each is a typed function
 * `(input) → { subject, html, text }` that describes its content and leaves layout and escaping to
 * `renderEmail`.
 *
 * **Inputs carry customer-safe fields only**: names, references, service names, dates, amounts and a
 * link. There is no field for an internal note, a free-text description, a staff name or an
 * address, so none can be passed in by mistake. The business name and contact details come from the
 * business settings; the dispatcher adds them, workflow code does not pass them.
 *
 * Links are absolute URLs built by the caller from `PUBLIC_WEB_URL` and a validated app path.
 */

/** A template's input as the template function receives it: its own fields plus the branding. */
type Branded<Input> = Input & EmailBranding;

const greeting = (customerName: string): string => `Hello ${customerName},`;

// --- Account ---------------------------------------------------------------------------------

export interface PasswordResetEmailInput {
  /** The full link, `${PUBLIC_WEB_URL}/reset-password?token=…`. */
  resetUrl: string;
  expiresInMinutes: number;
}

export const PASSWORD_RESET_TEMPLATE = "password-reset";

export function renderPasswordResetEmail(input: Branded<PasswordResetEmailInput>): RenderedEmail {
  const { businessName, resetUrl, expiresInMinutes } = input;
  return renderEmail(input, {
    subject: `Reset your ${businessName} password`,
    heading: `Reset your ${businessName} password`,
    intro: [
      `Someone asked to reset the password for your ${businessName} account. If that was you, choose a new password with the button below.`,
    ],
    action: { label: "Choose a new password", url: resetUrl },
    outro: [
      `The link works once and expires in ${expiresInMinutes} minutes.`,
      "If you did not ask for this, you can ignore this email. Your password stays the same.",
    ],
  });
}

/** Sent by `npm run email:test` to prove SMTP delivery. Never part of a workflow. */
export interface SmtpTestEmailInput {
  sentAt: Date;
  timeZone: string;
}

export function renderSmtpTestEmail(input: Branded<SmtpTestEmailInput>): RenderedEmail {
  return renderEmail(input, {
    subject: "FixFlow email test",
    heading: "FixFlow email test",
    intro: [
      "This message was sent by the FixFlow email test script. If you can read it, the SMTP settings work and the server can deliver email.",
      `Sent ${formatEmailDateTime(input.sentAt, input.timeZone)}.`,
    ],
  });
}

// --- Requests --------------------------------------------------------------------------------

export interface RequestReceivedCustomerEmailInput {
  customerName: string;
  requestReference: string;
  serviceName: string;
  requestUrl: string;
  /** The window the customer asked for, as instants; shown in `timeZone`. */
  preferredStart: Date;
  preferredEnd: Date;
  /** The business time zone (IANA), from the business settings. */
  timeZone: string;
}

export function renderRequestReceivedCustomerEmail(
  input: Branded<RequestReceivedCustomerEmailInput>,
): RenderedEmail {
  const {
    businessName,
    customerName,
    requestReference,
    serviceName,
    requestUrl,
    preferredStart,
    preferredEnd,
    timeZone,
  } = input;
  return renderEmail(input, {
    subject: `We received your request ${requestReference}`,
    heading: "We received your request",
    intro: [
      greeting(customerName),
      `Thanks for contacting ${businessName}. We have your request for ${serviceName}.`,
    ],
    details: [
      { label: "Reference", value: requestReference },
      { label: "Service", value: serviceName },
      { label: "Preferred time", value: formatEmailWindow(preferredStart, preferredEnd, timeZone) },
    ],
    action: { label: "View your request", url: requestUrl },
    outro: [
      "What happens next: a member of our team will review your request and send you a quotation to accept or decline. We may contact you first if we have a question.",
      "The time above is the one you prefer, not a booking. We will confirm the exact time with you before any work is scheduled.",
    ],
  });
}

export interface RequestReceivedAdminEmailInput {
  requestReference: string;
  serviceName: string;
  customerName: string;
  requestUrl: string;
}

export function renderRequestReceivedAdminEmail(
  input: Branded<RequestReceivedAdminEmailInput>,
): RenderedEmail {
  const { customerName, requestReference, serviceName, requestUrl } = input;
  return renderEmail(input, {
    subject: `New request ${requestReference}: ${serviceName}`,
    heading: "A new service request has arrived",
    intro: [`${customerName} has asked for ${serviceName}. The request is waiting for review.`],
    details: [
      { label: "Reference", value: requestReference },
      { label: "Service", value: serviceName },
      { label: "Customer", value: customerName },
    ],
    action: { label: "Review the request", url: requestUrl },
  });
}

export interface RequestCancelledEmailInput {
  customerName: string;
  requestReference: string;
  serviceName: string;
  requestUrl: string;
  /**
   * The message the business chose to send the customer when it cancelled (FR-026). When there is
   * none the email says nothing more than the neutral text. There is deliberately **no field for the
   * internal reason**: it cannot be passed in, so it cannot reach a customer (BR-19).
   */
  customerMessage?: string | undefined;
}

export function renderRequestCancelledEmail(
  input: Branded<RequestCancelledEmailInput>,
): RenderedEmail {
  const { businessName, customerName, requestReference, serviceName, requestUrl, customerMessage } =
    input;
  const messageParagraphs =
    customerMessage === undefined || customerMessage.trim() === ""
      ? []
      : [
          `A message from ${businessName}:`,
          ...customerMessage
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line !== ""),
        ];
  return renderEmail(input, {
    subject: `Request ${requestReference} was cancelled`,
    heading: "Your request was cancelled",
    intro: [
      greeting(customerName),
      `Your request for ${serviceName} has been cancelled, so no work will be scheduled for it.`,
      ...messageParagraphs,
    ],
    details: [
      { label: "Reference", value: requestReference },
      { label: "Service", value: serviceName },
    ],
    action: { label: "View the request", url: requestUrl },
    outro: ["If this is not what you expected, please contact us."],
  });
}

// --- Quotations ------------------------------------------------------------------------------

export interface QuotationSentEmailInput {
  customerName: string;
  quotationReference: string;
  serviceName: string;
  /** Decimal string, for example `"108.00"`. */
  totalAmount: string;
  currencyCode: string;
  /** `YYYY-MM-DD`. */
  validUntil: string;
  quotationUrl: string;
}

export function renderQuotationSentEmail(input: Branded<QuotationSentEmailInput>): RenderedEmail {
  const { businessName, customerName, quotationReference, serviceName, quotationUrl } = input;
  return renderEmail(input, {
    subject: `Your quotation ${quotationReference} from ${businessName}`,
    heading: "Your quotation is ready",
    intro: [
      greeting(customerName),
      `We have prepared a quotation for ${serviceName}. Please review it and let us know whether you would like to go ahead.`,
    ],
    details: [
      { label: "Quotation", value: quotationReference },
      { label: "Service", value: serviceName },
      { label: "Total", value: formatEmailMoney(input.totalAmount, input.currencyCode) },
      { label: "Valid until", value: formatEmailDate(input.validUntil) },
    ],
    action: { label: "Review your quotation", url: quotationUrl },
    outro: ["You can accept or decline it online. Please answer before it expires."],
  });
}

export interface QuotationWithdrawnEmailInput {
  customerName: string;
  quotationReference: string;
  serviceName: string;
  requestUrl: string;
}

export function renderQuotationWithdrawnEmail(
  input: Branded<QuotationWithdrawnEmailInput>,
): RenderedEmail {
  const { customerName, quotationReference, serviceName, requestUrl } = input;
  return renderEmail(input, {
    subject: `Quotation ${quotationReference} was withdrawn`,
    heading: "A quotation was withdrawn",
    intro: [
      greeting(customerName),
      `We have withdrawn quotation ${quotationReference} for ${serviceName}. It can no longer be accepted. If we send a replacement, you will be notified.`,
    ],
    details: [
      { label: "Quotation", value: quotationReference },
      { label: "Service", value: serviceName },
    ],
    action: { label: "View your request", url: requestUrl },
  });
}

export interface QuotationDecisionAdminEmailInput {
  customerName: string;
  quotationReference: string;
  serviceName: string;
  decision: "ACCEPTED" | "DECLINED";
  totalAmount: string;
  currencyCode: string;
  requestUrl: string;
}

export function renderQuotationDecisionAdminEmail(
  input: Branded<QuotationDecisionAdminEmailInput>,
): RenderedEmail {
  const { customerName, quotationReference, serviceName, decision, requestUrl } = input;
  const verb = decision === "ACCEPTED" ? "accepted" : "declined";
  return renderEmail(input, {
    subject: `${customerName} ${verb} quotation ${quotationReference}`,
    heading: `Quotation ${verb}`,
    intro: [
      decision === "ACCEPTED"
        ? `${customerName} accepted the quotation for ${serviceName}. A job can now be created and scheduled.`
        : `${customerName} declined the quotation for ${serviceName}. No work will be scheduled unless a new quotation is sent.`,
    ],
    details: [
      { label: "Quotation", value: quotationReference },
      { label: "Customer", value: customerName },
      { label: "Service", value: serviceName },
      { label: "Total", value: formatEmailMoney(input.totalAmount, input.currencyCode) },
    ],
    action: { label: "Open the request", url: requestUrl },
  });
}

// --- Jobs ------------------------------------------------------------------------------------

interface JobEmailBase {
  customerName: string;
  jobReference: string;
  serviceName: string;
  jobUrl: string;
}

function jobDetails(input: JobEmailBase): Array<{ label: string; value: string }> {
  return [
    { label: "Job", value: input.jobReference },
    { label: "Service", value: input.serviceName },
  ];
}

export interface JobScheduledEmailInput extends JobEmailBase {
  scheduledStart: Date;
  scheduledEnd: Date;
  /** The business time zone (IANA), from the business settings. */
  timeZone: string;
}

export function renderJobScheduledEmail(input: Branded<JobScheduledEmailInput>): RenderedEmail {
  const { customerName, serviceName, jobUrl, scheduledStart, scheduledEnd, timeZone } = input;
  const when = formatEmailWindow(scheduledStart, scheduledEnd, timeZone);
  return renderEmail(input, {
    subject: `Your ${serviceName} visit is scheduled`,
    heading: "Your visit is scheduled",
    intro: [greeting(customerName), `We have scheduled your ${serviceName} visit.`],
    details: [...jobDetails(input), { label: "When", value: when }],
    action: { label: "View job details", url: jobUrl },
    outro: ["If this time does not work for you, please contact us as soon as you can."],
  });
}

export interface JobRescheduledEmailInput extends JobScheduledEmailInput {
  previousStart: Date;
  previousEnd: Date;
}

export function renderJobRescheduledEmail(input: Branded<JobRescheduledEmailInput>): RenderedEmail {
  const { customerName, serviceName, jobUrl, scheduledStart, scheduledEnd, timeZone } = input;
  return renderEmail(input, {
    subject: `Your ${serviceName} visit has moved`,
    heading: "Your visit has been rescheduled",
    intro: [greeting(customerName), `We have moved your ${serviceName} visit to a new time.`],
    details: [
      ...jobDetails(input),
      { label: "New time", value: formatEmailWindow(scheduledStart, scheduledEnd, timeZone) },
      {
        label: "Previous time",
        value: formatEmailWindow(input.previousStart, input.previousEnd, timeZone),
      },
    ],
    action: { label: "View job details", url: jobUrl },
    outro: ["If the new time does not work for you, please contact us as soon as you can."],
  });
}

export type JobNeedsReschedulingEmailInput = JobEmailBase;

export function renderJobNeedsReschedulingEmail(
  input: Branded<JobNeedsReschedulingEmailInput>,
): RenderedEmail {
  const { customerName, serviceName, jobUrl } = input;
  return renderEmail(input, {
    subject: `We need to find a new time for your ${serviceName} visit`,
    heading: "We need to reschedule your visit",
    intro: [
      greeting(customerName),
      `We can no longer keep the time we had for your ${serviceName} visit, and we are arranging a new one. You will be notified as soon as it is scheduled.`,
    ],
    details: jobDetails(input),
    action: { label: "View job details", url: jobUrl },
    outro: ["We are sorry for the inconvenience."],
  });
}

export type JobCompletedEmailInput = JobEmailBase;

export function renderJobCompletedEmail(input: Branded<JobCompletedEmailInput>): RenderedEmail {
  const { customerName, serviceName, jobUrl } = input;
  return renderEmail(input, {
    subject: `Your ${serviceName} job is complete`,
    heading: "Your job is complete",
    intro: [
      greeting(customerName),
      `Your ${serviceName} job has been marked as complete. Thank you for choosing us.`,
    ],
    details: jobDetails(input),
    action: { label: "View job details", url: jobUrl },
    outro: ["If there is anything to pay, an invoice will follow."],
  });
}

export type JobCancelledEmailInput = JobEmailBase;

export function renderJobCancelledEmail(input: Branded<JobCancelledEmailInput>): RenderedEmail {
  const { customerName, serviceName, jobUrl } = input;
  return renderEmail(input, {
    subject: `Your ${serviceName} job was cancelled`,
    heading: "Your job was cancelled",
    intro: [
      greeting(customerName),
      `Your ${serviceName} job has been cancelled, so no visit will take place.`,
    ],
    details: jobDetails(input),
    action: { label: "View job details", url: jobUrl },
    outro: ["If this is not what you expected, please contact us."],
  });
}

// --- Invoices and payments -------------------------------------------------------------------

export interface InvoiceIssuedEmailInput {
  customerName: string;
  invoiceReference: string;
  totalAmount: string;
  currencyCode: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  invoiceUrl: string;
}

export function renderInvoiceIssuedEmail(input: Branded<InvoiceIssuedEmailInput>): RenderedEmail {
  const { businessName, customerName, invoiceReference, invoiceUrl } = input;
  return renderEmail(input, {
    subject: `Invoice ${invoiceReference} from ${businessName}`,
    heading: "Your invoice is ready",
    intro: [
      greeting(customerName),
      `Invoice ${invoiceReference} is ready. You can see what it covers and how to pay in your account.`,
    ],
    details: [
      { label: "Invoice", value: invoiceReference },
      { label: "Total", value: formatEmailMoney(input.totalAmount, input.currencyCode) },
      { label: "Due", value: formatEmailDate(input.dueDate) },
    ],
    action: { label: "View invoice", url: invoiceUrl },
    outro: [
      `Payment is made directly to ${businessName}, following the instructions on the invoice.`,
    ],
  });
}

export interface InvoiceVoidedEmailInput {
  customerName: string;
  invoiceReference: string;
  invoiceUrl: string;
}

export function renderInvoiceVoidedEmail(input: Branded<InvoiceVoidedEmailInput>): RenderedEmail {
  const { customerName, invoiceReference, invoiceUrl } = input;
  return renderEmail(input, {
    subject: `Invoice ${invoiceReference} was voided`,
    heading: "An invoice was voided",
    intro: [
      greeting(customerName),
      `We have voided invoice ${invoiceReference}, so you do not need to pay it. If a corrected invoice is needed, you will be notified.`,
    ],
    details: [{ label: "Invoice", value: invoiceReference }],
    action: { label: "View invoice", url: invoiceUrl },
  });
}

export interface PaymentRecordedEmailInput {
  customerName: string;
  invoiceReference: string;
  /** The amount of this payment, a decimal string. */
  paymentAmount: string;
  currencyCode: string;
  /** `YYYY-MM-DD`. */
  paymentDate: string;
  /** What is still owed after this payment, a decimal string (`"0.00"` when paid in full). */
  balance: string;
  invoiceUrl: string;
}

export function renderPaymentRecordedEmail(
  input: Branded<PaymentRecordedEmailInput>,
): RenderedEmail {
  const { customerName, invoiceReference, currencyCode, invoiceUrl } = input;
  // A decimal string, so test it as text: money is never converted to a float.
  const settled = /^0+(\.0+)?$/.test(input.balance);
  return renderEmail(input, {
    subject: `Payment recorded for invoice ${invoiceReference}`,
    heading: "We recorded your payment",
    intro: [
      greeting(customerName),
      settled
        ? `We have recorded your payment for invoice ${invoiceReference}. The invoice is now paid in full. Thank you.`
        : `We have recorded your payment for invoice ${invoiceReference}. A balance remains on the invoice.`,
    ],
    details: [
      { label: "Invoice", value: invoiceReference },
      { label: "Payment", value: formatEmailMoney(input.paymentAmount, currencyCode) },
      { label: "Payment date", value: formatEmailDate(input.paymentDate) },
      { label: "Balance", value: formatEmailMoney(input.balance, currencyCode) },
    ],
    action: { label: "View invoice", url: invoiceUrl },
  });
}

// --- Registry --------------------------------------------------------------------------------

/**
 * Every template by name. The name is what `EmailDeliveryLog.template` records and what the log
 * transport puts in its file names, so keep them stable.
 */
export const EMAIL_TEMPLATES = {
  [PASSWORD_RESET_TEMPLATE]: renderPasswordResetEmail,
  "smtp-test": renderSmtpTestEmail,
  "request-received-customer": renderRequestReceivedCustomerEmail,
  "request-received-admin": renderRequestReceivedAdminEmail,
  "request-cancelled": renderRequestCancelledEmail,
  "quotation-sent": renderQuotationSentEmail,
  "quotation-withdrawn": renderQuotationWithdrawnEmail,
  "quotation-decision-admin": renderQuotationDecisionAdminEmail,
  "job-scheduled": renderJobScheduledEmail,
  "job-rescheduled": renderJobRescheduledEmail,
  "job-needs-rescheduling": renderJobNeedsReschedulingEmail,
  "job-completed": renderJobCompletedEmail,
  "job-cancelled": renderJobCancelledEmail,
  "invoice-issued": renderInvoiceIssuedEmail,
  "invoice-voided": renderInvoiceVoidedEmail,
  "payment-recorded": renderPaymentRecordedEmail,
} as const satisfies Record<string, (input: never) => RenderedEmail>;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;

/** What workflow code passes for a template: its own fields, without the branding. */
export type EmailTemplateInput<Name extends EmailTemplateName> = Omit<
  Parameters<(typeof EMAIL_TEMPLATES)[Name]>[0],
  keyof EmailBranding
>;

export const EMAIL_TEMPLATE_NAMES = Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[];

/** Renders any template by name; the input type follows the name. */
export function renderEmailTemplate<Name extends EmailTemplateName>(
  name: Name,
  input: EmailTemplateInput<Name>,
  branding: EmailBranding,
): RenderedEmail {
  const render = EMAIL_TEMPLATES[name] as (
    input: EmailTemplateInput<Name> & EmailBranding,
  ) => RenderedEmail;
  return render({ ...input, ...branding });
}
