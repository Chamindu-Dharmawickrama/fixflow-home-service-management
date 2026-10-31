import {
  type AdminQuotationDto,
  type FieldErrors,
  isDateOnly,
  LIMITS,
  tryCalculateDocumentTotals,
  type UpdateQuotationBody,
} from "@fixflow/shared";
import { z } from "zod";

import { EMPTY_LINE, type LineItemFormValue } from "@/components/forms/line-items";

/** One quotation (IA-A04), keyed by its id: a reference is a label, never the address. */
export function adminQuotationPath(id: string): string {
  return `/app/quotations/${encodeURIComponent(id)}`;
}

// ---- The editor's form ------------------------------------------------------------------------

/** What the draft editor holds. Every number is the text typed (CLAUDE.md §9). */
export interface QuotationFormValues {
  lines: LineItemFormValue[];
  discountAmount: string;
  /** A percentage: `"8.00"` means 8 %. */
  taxRate: string;
  /** `YYYY-MM-DD`. */
  validUntil: string;
  terms: string;
  customerNote: string;
}

/** `"1.50"` → `"1.5"`, `"2.00"` → `"2"`: a quantity as a person writes it. Prices keep their two places. */
export function trimTrailingZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

/** The saved draft as the editor shows it. */
export function quotationToFormValues(quotation: AdminQuotationDto): QuotationFormValues {
  return {
    lines: quotation.lines.map((line) => ({
      description: line.description,
      quantity: trimTrailingZeros(line.quantity),
      unitPrice: line.unitPrice,
      taxable: line.taxable,
    })),
    discountAmount: quotation.discountAmount,
    taxRate: quotation.taxRate,
    validUntil: quotation.validUntil,
    terms: quotation.terms ?? "",
    customerNote: quotation.customerNote ?? "",
  };
}

/** The values for a new draft are always the server's; this is only the shape of an empty form. */
export const EMPTY_QUOTATION_FORM: QuotationFormValues = {
  lines: [EMPTY_LINE],
  discountAmount: "0.00",
  taxRate: "0.00",
  validUntil: "",
  terms: "",
  customerNote: "",
};

/** What `PATCH /admin/quotations/:id` takes. Totals are not in it: the server works them out. */
export function toUpdateBody(
  values: QuotationFormValues,
  expectedUpdatedAt: string,
): UpdateQuotationBody {
  const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());
  return {
    lines: values.lines.map((line) => ({
      description: line.description.trim(),
      quantity: line.quantity.trim(),
      unitPrice: line.unitPrice.trim(),
      taxable: line.taxable,
    })),
    discountAmount: values.discountAmount.trim(),
    taxRate: values.taxRate.trim(),
    validUntil: values.validUntil,
    terms: blankToNull(values.terms),
    customerNote: blankToNull(values.customerNote),
    expectedUpdatedAt,
  };
}

const DESCRIPTION_MISSING = "Describe the work or item on this line.";
const VALID_UNTIL_MISSING = "Choose the last day the quotation is valid.";

/**
 * Everything wrong with the form, as the API would say it (`fieldErrors`, keyed `lines.2.quantity`),
 * for early feedback beside each field. The amounts are judged by the shared calculation, the code
 * the server runs, so the form and the server cannot disagree about a quantity or a discount. The
 * server applies the rules again and is the authority.
 */
export function quotationFormProblems(values: QuotationFormValues): FieldErrors {
  const problems: FieldErrors = {};

  values.lines.forEach((line, index) => {
    const description = line.description.trim();
    if (description === "") {
      problems[`lines.${index}.description`] = DESCRIPTION_MISSING;
    } else if (description.length > LIMITS.lineDescription.maxLength) {
      problems[`lines.${index}.description`] =
        `Keep the description to ${LIMITS.lineDescription.maxLength} characters or fewer.`;
    }
  });

  const calculation = tryCalculateDocumentTotals({
    lines: values.lines.map(({ quantity, unitPrice, taxable }) => ({
      quantity: quantity.trim(),
      unitPrice: unitPrice.trim(),
      taxable,
    })),
    discountAmount: values.discountAmount.trim(),
    taxRate: values.taxRate.trim(),
  });
  if (!calculation.ok) {
    Object.assign(problems, calculation.fieldErrors);
  }

  if (!isDateOnly(values.validUntil)) {
    problems.validUntil = VALID_UNTIL_MISSING;
  }
  if (values.terms.length > LIMITS.businessSettings.quotationTerms.maxLength) {
    problems.terms = `Keep the terms to ${LIMITS.businessSettings.quotationTerms.maxLength} characters or fewer.`;
  }
  if (values.customerNote.length > LIMITS.notes.maxLength) {
    problems.customerNote = `Keep the note to ${LIMITS.notes.maxLength} characters or fewer.`;
  }
  return problems;
}

const lineValueSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  taxable: z.boolean(),
});

/**
 * The form's schema. The fields are plain text here on purpose: one check over the whole form
 * ({@link quotationFormProblems}) reports every problem at once, the description of one line beside
 * the quantity of another, which per-field rules would not (an invalid field hides the form-level check).
 */
export const quotationFormSchema = z
  .object({
    lines: z.array(lineValueSchema),
    discountAmount: z.string(),
    taxRate: z.string(),
    validUntil: z.string(),
    terms: z.string(),
    customerNote: z.string(),
  })
  .superRefine((values, context) => {
    for (const [path, message] of Object.entries(quotationFormProblems(values))) {
      context.addIssue({
        code: "custom",
        message,
        path: path.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
      });
    }
  });

/** The words that name a field in the list of problems; a line's fields say which line. */
export function quotationFieldLabels(lineCount: number): Record<string, string> {
  const labels: Record<string, string> = {
    lines: "Line items",
    discountAmount: "Discount",
    taxRate: "Tax rate",
    validUntil: "Valid until",
    terms: "Terms",
    customerNote: "Note for the customer",
  };
  for (let index = 0; index < lineCount; index += 1) {
    labels[`lines.${index}.description`] = `Line ${index + 1} description`;
    labels[`lines.${index}.quantity`] = `Line ${index + 1} quantity`;
    labels[`lines.${index}.unitPrice`] = `Line ${index + 1} unit price`;
  }
  return labels;
}

const FORM_FIELD =
  /^(lines(\.\d+\.(description|quantity|unitPrice|taxable))?|discountAmount|taxRate|validUntil|terms|customerNote)$/;

/**
 * Splits the API's `fieldErrors` into what sits beside a field of the editor and what has no field of
 * its own (the total being zero, say), which is shown as a message above the form.
 */
export function splitApiProblems(fieldErrors: FieldErrors | undefined): {
  fields: FieldErrors;
  banner: string | null;
} {
  const fields: FieldErrors = {};
  const loose: string[] = [];
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (FORM_FIELD.test(path)) {
      fields[path] = message;
    } else {
      loose.push(message);
    }
  }
  return { fields, banner: loose.length === 0 ? null : loose.join(" ") };
}
